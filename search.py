import urllib.request, re

url = "https://html.duckduckgo.com/html/?q='cloudcode-pa.googleapis.com'+temperature+maxOutputTokens"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
try:
    html = urllib.request.urlopen(req).read().decode('utf-8')
    snippets = re.findall(r'<a class="result__snippet[^>]*>(.*?)</a>', html, flags=re.IGNORECASE|re.DOTALL)
    urls = re.findall(r'<a class="result__url" href="([^"]+)">', html, flags=re.IGNORECASE)
    for u, s in zip(urls, snippets):
        print(f"URL: {u}\nSnippet: {s}\n---")
except Exception as e:
    print(f"Error: {e}")
