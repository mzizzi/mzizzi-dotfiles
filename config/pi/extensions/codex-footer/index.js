import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const quotaKey = "codex-usage";
const separator = " · ";
const separatorWidth = visibleWidth(separator);
const ellipsis = "…";

function sanitizeLocation(text) {
  return text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "?");
}

function renderPrimaryRow(cwd, footerData, quota, width) {
  let locationWidth = width;
  if (quota) {
    const quotaWidth = visibleWidth(quota);
    if (quotaWidth > width) return truncateToWidth(quota, width, "");

    locationWidth -= quotaWidth + separatorWidth;
    if (locationWidth <= 0) return quota;
  }

  const branch = footerData.getGitBranch();
  const location = branch ? `${cwd} (${sanitizeLocation(branch)})` : cwd;
  const clippedLocation = truncateToWidth(location, locationWidth, ellipsis);
  return quota ? clippedLocation + separator + quota : clippedLocation;
}

function formatOtherStatuses(statuses) {
  if (statuses.size === 0 || (statuses.size === 1 && statuses.has(quotaKey))) return "";

  return [...statuses]
    .filter(([key]) => key !== quotaKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, text]) => text.replace(/[ \r\n\t]+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
}

export default function (pi) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const cwd = sanitizeLocation(ctx.cwd);
    ctx.ui.setFooter((tui, _theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      return {
        render(width) {
          if (width <= 0) return [];

          const statuses = footerData.getExtensionStatuses();
          const rows = [renderPrimaryRow(cwd, footerData, statuses.get(quotaKey), width)];
          const other = formatOtherStatuses(statuses);
          if (other) rows.push(truncateToWidth(other, width, ellipsis));
          return rows;
        },
        invalidate() {},
        dispose: unsubscribe,
      };
    });
  });
}
