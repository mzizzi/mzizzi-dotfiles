
Prefer using `jq` for reading and interpreting JSON data. You can still use `python` for complex tasks but understand that using `python` typically requires user approval. `jq` is safe and use is automatically approved.

Prefer passing the full filepath to `jq` instead of `cd <dir> && cat <file> | jq <query>` types of commands. This will be automatically approved without needing to wait for user confirmation.

When querying JSON data prefer to use `jq` instead of python commands. e.g. use `jq` instead of:
* `python -c "import sys,json; print(json.dumps(...))"`
* `python -m json.tool ...`