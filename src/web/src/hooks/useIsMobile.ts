import { useEffect, useState } from 'react';

export const MOBILE_LAYOUT_QUERY = '(max-width: 900px)';

function getMatches(query: string): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia(query).matches;
}

export function useIsMobile(query: string = MOBILE_LAYOUT_QUERY): boolean {
  const [matches, setMatches] = useState(() => getMatches(query));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia(query);
    const handleChange = () => setMatches(media.matches);

    handleChange();
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
