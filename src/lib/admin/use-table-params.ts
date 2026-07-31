"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

/**
 * 표의 검색·필터·정렬·페이지 상태를 URL 쿼리에 둔다.
 *
 * useState로 들고 있으면 새로고침에 날아가고, 조건을 걸어둔 화면을 링크로
 * 공유할 수 없으며, 뒤로가기가 필터 히스토리를 되돌려주지 않는다. 운영 기록
 * 화면이 이미 searchParams를 쓰고 있어 동작 방식도 그쪽에 맞춘다.
 *
 * 기본값과 같은 값은 쿼리에서 지워 URL이 불필요하게 길어지지 않게 한다.
 */
export function useTableParams<Defaults extends Record<string, string | number>>(
  defaults: Defaults
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const values = useMemo(() => {
    const resolved = {} as { [K in keyof Defaults]: string };
    for (const key of Object.keys(defaults) as Array<keyof Defaults & string>) {
      resolved[key] = searchParams.get(key) ?? String(defaults[key]);
    }
    return resolved;
  }, [defaults, searchParams]);

  const setValues = useCallback(
    (next: Partial<Record<keyof Defaults & string, string | number | null>>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(next)) {
        const defaultValue = String(defaults[key as keyof Defaults]);
        if (value === null || value === undefined || String(value) === defaultValue) {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      }

      // 조건이 바뀌면 보고 있던 페이지 번호는 의미를 잃는다.
      if (!("page" in next) && Object.keys(next).length > 0) params.delete("page");

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [defaults, pathname, router, searchParams]
  );

  const numberOf = useCallback(
    (key: keyof Defaults & string) => {
      const parsed = Number.parseInt(values[key], 10);
      return Number.isFinite(parsed) ? parsed : Number(defaults[key]);
    },
    [defaults, values]
  );

  return { values, setValues, numberOf };
}
