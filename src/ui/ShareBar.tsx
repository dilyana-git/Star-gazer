/**
 * Take it with you: copy a link to exactly this sky, or print the night as a
 * sheet. Both are Phase 4 elaborations, and both are one button.
 */
import { useState } from 'react';
import { useStore } from '../state/store';

export function ShareBar() {
  const permalink = useStore((s) => s.permalink);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const url = permalink();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // No clipboard permission — the URL is already in the address bar, which
      // is the honest fallback rather than a modal nobody asked for.
      setCopied(false);
    }
  };

  return (
    <div className="share">
      <button type="button" onClick={copy} title="Copy a link to this exact sky">
        {copied ? 'Link copied' : 'Copy link'}
      </button>
      <button type="button" onClick={() => window.print()} title="Print tonight's plan">
        Print plan
      </button>
    </div>
  );
}
