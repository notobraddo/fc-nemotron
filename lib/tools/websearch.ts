export async function webSearch(query: string): Promise<string> {
  try {
    // Pakai DuckDuckGo Instant Answer API (gratis, tanpa API key)
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    );
    const data = await res.json();

    let result = "";

    // Abstract (ringkasan utama)
    if (data.AbstractText) {
      result += `📝 ${data.AbstractText}\n`;
    }

    // Related topics
    if (data.RelatedTopics?.length > 0) {
      const topics = data.RelatedTopics
        .slice(0, 3)
        .filter((t: any) => t.Text)
        .map((t: any) => `• ${t.Text}`)
        .join("\n");
      if (topics) result += `\n🔗 Related:\n${topics}`;
    }

    return result || `Tidak ada hasil untuk "${query}". Coba kata kunci lain.`;
  } catch {
    return "Gagal melakukan web search.";
  }
}
