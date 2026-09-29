export function browserAddress(input: string): string | null {
  const value = input.trim();
  if (!value || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null;
  const candidate = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(value) ? `http://${value}` :
    /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url.href : null;
  } catch { return null; }
}

export function localPreviewLink(href: string): string | null {
  try {
    const url = new URL(href);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]") ? url.href : null;
  } catch { return null; }
}

export function conversationLocalLinks(messages: string[]): string[] {
  const found = new Set<string>();
  for (const text of messages) {
    for (const match of text.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/[^\s)<>]*)?/gi)) {
      const url = localPreviewLink(match[0].replace(/[.,;!?]+$/, ""));
      if (url) found.add(url);
    }
  }
  return [...found].slice(-5).reverse();
}

export function fileLinkPath(href: string, folder: string): string | null {
  let value: string;
  try { value = decodeURIComponent(href.trim().replace(/^file:\/\//, "")); }
  catch { return null; }
  const relative = (value.startsWith(`${folder}/`) && folder ? value.slice(folder.length + 1) : value).replace(/^\.\//, "");
  if (!relative || relative.startsWith("/") || relative.includes("\\") ||
    relative.split("/").some(part => !part || part === "." || part === "..") ||
    /^[a-z][a-z\d+.-]*:/i.test(relative)) return null;
  return relative;
}
