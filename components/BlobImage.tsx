"use client";

import { useEffect, useState } from "react";

/**
 * Renders a Blob (original/processed/thumbnail image) as an <img>,
 * managing the object URL lifecycle so URLs are revoked on unmount.
 */
export default function BlobImage({
  blob,
  alt = "",
  className = "",
}: {
  blob: Blob | undefined | null;
  alt?: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [blob]);

  if (!url) return null;
  return <img src={url} alt={alt} className={className} />;
}
