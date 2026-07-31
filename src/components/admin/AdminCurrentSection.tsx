"use client";

import { usePathname } from "next/navigation";
import { findAdminNavLabel } from "./admin-navigation-items";

/**
 * 상단바가 모든 화면에서 "운영 관리"로 고정돼 있으면 현재 위치를 알려주지
 * 못한다. 사이드바와 같은 메뉴 정의를 보고 현재 화면 이름을 표시한다.
 */
export default function AdminCurrentSection() {
  return <>{findAdminNavLabel(usePathname())}</>;
}
