"use client";

import { useEffect, useState } from "react";
import MarkdownContent from "@/components/MarkdownContent";

export default function ImagePreviewCheck() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return <main style={{ maxWidth: 960, padding: 24, margin: "0 auto" }}>
    <h1>Wiki image interaction check</h1>
    <MarkdownContent owner="local" repo="test" slugByName={new Map()} onNavigate={() => {}}
      page={{ slug: "image-preview-check", path: "check.md", title: "Image check", category: "test", frontmatter: {}, links: [],
        content: `![Test image](${origin}/image-preview-check.svg)

<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 450" role="img" aria-label="Inline architecture"><title>Inline architecture</title><rect width="900" height="450" fill="#fff8ed"/><rect x="100" y="120" width="260" height="160" rx="20" fill="#e07a5f"/><path d="M380 200h140" stroke="#513a31" stroke-width="10"/><rect x="540" y="120" width="260" height="160" rx="20" fill="#8fa898"/><text x="230" y="210" text-anchor="middle" font-size="32" fill="#191716">Producer</text><text x="670" y="210" text-anchor="middle" font-size="32" fill="#191716">Consumer</text></svg>

[![Linked image](${origin}/image-preview-check.svg)](#target)

## Target

Image-link navigation remains available.

\`\`\`mermaid
flowchart LR
  Input --> Output
\`\`\`

![Unavailable image](${origin}/image-preview-missing.png)` }} />
  </main>;
}
