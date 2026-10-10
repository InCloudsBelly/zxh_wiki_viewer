"use client";

import { useEffect, useState } from "react";
import type { WikiData } from "@/lib/github";
import WikiViewer from "@/components/WikiViewer";

function LocalWikiContent() {
  const [data, setData] = useState<WikiData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/wiki/local", { cache: "no-store" });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || "Failed to load local wiki");
        }
        setData(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  return (
    <WikiViewer
      data={data}
      loading={loading}
      error={error}
      label="个人 Wiki"
      owner="local"
      repo="personal-wiki"
    />
  );
}

export default function LocalWikiPage() {
  return <LocalWikiContent />;
}
