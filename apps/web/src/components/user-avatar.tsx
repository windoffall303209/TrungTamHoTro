"use client";

import Image from "next/image";
import { useState } from "react";
import { publicApiUrl } from "@/lib/api-client";

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(-2).map((part) => part[0]?.toUpperCase()).join("") || "U";
}

export function UserAvatar({ avatarUrl, name, className = "size-11", priority = false }: { avatarUrl?: string | null; name: string; className?: string; priority?: boolean }) {
  const source = avatarUrl ? /^(?:blob:|data:|https?:\/\/)/.test(avatarUrl) ? avatarUrl : publicApiUrl(avatarUrl) : "";

  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--avatar)] font-extrabold text-[var(--ink)] ring-1 ring-[var(--rule-strong)] ${className}`}>
      {source ? <AvatarImage key={source} name={name} priority={priority} source={source} /> : <span aria-hidden="true">{initials(name)}</span>}
    </span>
  );
}

function AvatarImage({ source, name, priority }: { source: string; name: string; priority: boolean }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span aria-hidden="true">{initials(name)}</span> : <Image alt={`Ảnh đại diện của ${name}`} className="object-cover" fill loader={({ src }) => src} onError={() => setFailed(true)} priority={priority} sizes="96px" src={source} unoptimized />;
}
