/**
 * 관리자 화면 아이콘 단일 출처.
 *
 * 이전에는 같은 이름의 아이콘이 파일마다 따로 정의돼 있었고, DatabaseIcon처럼
 * 이름은 같은데 그림이 다른 경우까지 있었다. 화면을 오갈 때 같은 상태가 다른
 * 아이콘으로 보이는 것을 막기 위해 여기서만 정의한다.
 *
 * stroke/fill은 각 화면 CSS(.navIcon, .summaryItem svg 등)가 지정한다.
 */

type IconProps = { className?: string };

function Icon({
  viewBox = "0 0 20 20",
  className,
  children,
}: IconProps & { viewBox?: string; children: React.ReactNode }) {
  return (
    <svg viewBox={viewBox} className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="m12.2 12.2 4 4" />
    </Icon>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m5 5 10 10M15 5 5 15" />
    </Icon>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m6 8 4 4 4-4" />
    </Icon>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m8 6 4 4-4 4" />
    </Icon>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m12 6-4 4 4 4" />
    </Icon>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M10 4v12M4 10h12" />
    </Icon>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m5 10 3 3 7-7" />
    </Icon>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M10 3 2.5 16h15L10 3Z" />
      <path d="M10 7v4M10 14h.01" />
    </Icon>
  );
}

export function ArrowUpIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m6 11 4-4 4 4M10 7v7" />
    </Icon>
  );
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="m6 9 4 4 4-4M10 13V6" />
    </Icon>
  );
}

export function SortIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M7 4v12M7 4 4.5 6.5M7 4l2.5 2.5M13 16V4M13 16l-2.5-2.5M13 16l2.5-2.5" />
    </Icon>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M10 3v9M10 12 6.5 8.5M10 12l3.5-3.5M4 15h12" />
    </Icon>
  );
}

export function ExternalIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M7 13 13 7M8 7h5v5" />
    </Icon>
  );
}

export function VideoIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="2.5" y="4" width="15" height="12" rx="2" />
      <path d="m8 7.5 4 2.5-4 2.5v-5Z" />
    </Icon>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m10 9 5 3-5 3V9Z" />
    </Icon>
  );
}

export function BookIcon({ className }: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" className={className}>
      <path d="M5 4.5h9a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3V4.5Z" />
      <path d="M17 7.5h2a2 2 0 0 1 2 2V20h-4" />
    </Icon>
  );
}

export function MemberIcon({ className }: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" className={className}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 11a3 3 0 0 1 4.5 2.6M17 16a4 4 0 0 1 4 3" />
    </Icon>
  );
}

export function ReceiptIcon({ className }: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" className={className}>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h3" />
    </Icon>
  );
}

export function ChartIcon({ className }: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" className={className}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20V7" />
    </Icon>
  );
}

export function LayersIcon({ className }: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" className={className}>
      <path d="m4 8 8-4 8 4-8 4-8-4Z" />
      <path d="m4 12 8 4 8-4M4 16l8 4 8-4" />
    </Icon>
  );
}

/** 데이터베이스 연결·마이그레이션 관련 안내에만 사용한다. */
export function DatabaseIcon({ className }: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" className={className}>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
    </Icon>
  );
}

export function ShieldIcon({ className }: IconProps) {
  return (
    <Icon viewBox="0 0 24 24" className={className}>
      <path d="M12 3 4.5 6v5.6c0 4.6 3.1 7.7 7.5 9.4 4.4-1.7 7.5-4.8 7.5-9.4V6L12 3Z" />
      <path d="m8.5 12 2.2 2.2 4.8-5" />
    </Icon>
  );
}
