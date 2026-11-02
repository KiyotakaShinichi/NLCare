import { useEffect } from "react";
import { createSearchParams, useLocation, useNavigate, useSearchParams } from "react-router-dom";

/**
 * View state in the query string, so a chosen view survives a reload. Values
 * outside the allowed list fall back to the default, so a hand-edited URL cannot
 * put the page in a state it has no rendering for. The value only selects a view;
 * it is never used as a navigation target.
 */
export function useAllowedQueryParam<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  const [params] = useSearchParams();
  const raw = params.get(key) as T | null;
  return raw && allowed.includes(raw) ? raw : fallback;
}

/**
 * Keeps a value in the URL. Section links drop the query string, so it is put back
 * after each one. The hash is kept, because the page scrolls when the hash changes.
 */
export function useKeepQueryParam<T extends string>(key: string, value: T, fallback: T) {
  const [params] = useSearchParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if ((params.get(key) ?? fallback) === value) return;
    const next = createSearchParams(params);
    if (value === fallback) next.delete(key);
    else next.set(key, value);
    const search = next.toString();
    navigate({ search: search ? `?${search}` : "", hash }, { replace: true });
  }, [key, value, fallback, params, hash, navigate]);
}
