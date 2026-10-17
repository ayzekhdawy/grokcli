/**
 * Lightweight file-kind chip for tree rows / tabs.
 */

import { IconFiles, IconFolder } from "@/components/icons";

export function FileKindMark({
  name,
  isDir,
}: {
  name: string;
  isDir: boolean;
}) {
  if (isDir) {
    return (
      <span className="rp-kind rp-kind--dir" aria-hidden>
        <IconFolder size={14} />
      </span>
    );
  }
  const lower = name.toLowerCase();
  const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";
  if (ext === "md" || ext === "mdx") {
    return (
      <span className="rp-kind rp-kind--md" aria-hidden>
        M
      </span>
    );
  }
  if (ext === "ts" || ext === "tsx" || ext === "js" || ext === "jsx") {
    return (
      <span className="rp-kind rp-kind--code" aria-hidden>
        {"{}"}
      </span>
    );
  }
  if (ext === "json" || ext === "toml" || ext === "yaml" || ext === "yml") {
    return (
      <span className="rp-kind rp-kind--data" aria-hidden>
        {"{ }"}
      </span>
    );
  }
  if (ext === "gitignore" || lower === ".gitignore") {
    return (
      <span className="rp-kind rp-kind--git" aria-hidden>
        ◆
      </span>
    );
  }
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    return (
      <span className="rp-kind rp-kind--img" aria-hidden>
        ▣
      </span>
    );
  }
  return (
    <span className="rp-kind rp-kind--file" aria-hidden>
      <IconFiles size={13} />
    </span>
  );
}
