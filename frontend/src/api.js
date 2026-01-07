const API_BASE = import.meta.env.VITE_API_BASE || "";

async function handleResponse(response) {
  if (!response.ok) {
    let message = "Request failed.";
    try {
      const data = await response.json();
      message = data.detail || message;
    } catch (error) {
      // ignore
    }
    throw new Error(message);
  }
  return response;
}

export async function fetchInfo(url) {
  const response = await handleResponse(
    await fetch(`${API_BASE}/api/info`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    })
  );
  return response.json();
}

export async function downloadVideo({ url, format_id: formatId, mode }) {
  const response = await handleResponse(
    await fetch(`${API_BASE}/api/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, format_id: formatId, mode }),
    })
  );

  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const fileNameMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  const fallbackMatch = disposition.match(/filename="?([^";]+)"?/i);
  const fileName = decodeURIComponent(
    (fileNameMatch && fileNameMatch[1]) || (fallbackMatch && fallbackMatch[1]) || "video"
  );

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  return fileName;
}
