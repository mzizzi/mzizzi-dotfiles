import { basename, dirname, isAbsolute } from "node:path";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const quotaKey = "codex-usage";
const separator = " · ";
const separatorWidth = visibleWidth(separator);
const ellipsis = "…";
const compactTokens = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function sanitizeText(text) {
  return text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "?");
}

async function repositoryName(pi, cwd) {
  const { code, stdout } = await pi.exec(
    "git",
    ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"],
    { cwd, timeout: 1000 },
  );
  const paths = stdout.split("\n");
  const [root, commonDir, end] = paths;
  if (
    code === 0 && paths.length === 3 && end === "" &&
    isAbsolute(root) && isAbsolute(commonDir)
  ) {
    const repo = basename(commonDir) === ".git" ? dirname(commonDir) : root;
    return basename(repo) || repo;
  }
  return basename(cwd) || cwd;
}

function formatTokens(tokens) {
  return Number.isFinite(tokens) && tokens >= 0 ? compactTokens.format(tokens) : "?";
}

function formatContext(model, usage) {
  const id = sanitizeText(model?.id || "?");
  const limit = usage?.contextWindow ?? model?.contextWindow;
  const limitText = limit > 0 ? formatTokens(limit) : "?";
  return `${id}${separator}ctx ${formatTokens(usage?.tokens)}/${limitText}`;
}

function renderPrimaryRow(name, footerData, quota, width) {
  let locationWidth = width;
  if (quota) {
    const quotaWidth = visibleWidth(quota);
    if (quotaWidth > width) return truncateToWidth(quota, width, "");

    locationWidth -= quotaWidth + separatorWidth;
    if (locationWidth <= 0) return quota;
  }

  const branch = footerData.getGitBranch();
  const location = branch ? `${name} (${sanitizeText(branch)})` : name;
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
  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode !== "tui") return;

    const name = sanitizeText(await repositoryName(pi, ctx.cwd));
    ctx.ui.setFooter((tui, _theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      let contextRow;
      return {
        render(width) {
          if (width <= 0) return [];

          const model = ctx.model;
          const leafId = ctx.sessionManager.getLeafId();
          // Computing context usage scans the session.
          if (!contextRow || contextRow.model !== model || contextRow.leafId !== leafId) {
            contextRow = { model, leafId, text: formatContext(model, ctx.getContextUsage()) };
          }

          const statuses = footerData.getExtensionStatuses();
          const rows = [
            renderPrimaryRow(name, footerData, statuses.get(quotaKey), width),
            truncateToWidth(contextRow.text, width, ellipsis),
          ];
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
