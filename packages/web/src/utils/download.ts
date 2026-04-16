/**
 * Trigger a file download in the browser.
 * Tries File System Access API first (PC Chrome), falls back to anchor click.
 */
export async function downloadFile(url: string, filename: string) {
  // For mobile, try opening in new tab to allow long-press save
  if (isMobile()) {
    window.open(url, "_blank");
    return;
  }

  // PC: standard download via anchor
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".mp4") ? filename : `${filename}.mp4`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export function isMobile(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}
