import styles from "./RouteLoading.module.css";

type RouteLoadingProps = {
  label?: string;
  tone?: "light" | "dark" | "admin";
};

export default function RouteLoading({
  label = "화면을 불러오고 있습니다",
  tone = "light",
}: RouteLoadingProps) {
  return (
    <div
      className={`${styles.loading} ${tone === "dark" ? styles.dark : ""} ${tone === "admin" ? styles.admin : ""}`}
      role="status"
      aria-live="polite"
    >
      <div className={styles.content}>
        <span className={styles.spinner} aria-hidden="true" />
        <span>{label}</span>
      </div>
    </div>
  );
}
