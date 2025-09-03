// src/Components/Event.js
import React from "react";

export default function Event({ description, url }) {
  const safeUrl = url && String(url).trim();

  if (!safeUrl) {
    return <span>{description || "(no title)"} </span>;
  }

  return (
    <a
      href={safeUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="event-link"
    >
      {description || "(no title)"}
    </a>
  );
}
