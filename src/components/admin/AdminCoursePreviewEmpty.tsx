import Link from "next/link";
import styles from "./AdminCoursePreviewEmpty.module.css";

export default function AdminCoursePreviewEmpty({ title }: { title: string }) {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <span>ADMIN PREVIEW</span>
        <h1>{title}</h1>
        <strong>미리볼 차시가 아직 없습니다.</strong>
        <p>강의 관리에서 챕터와 차시를 추가하면 공개 전에도 이 화면에서 강의실 구성을 검수할 수 있습니다.</p>
        <Link href="/admin/courses">강의 관리로 돌아가기</Link>
      </section>
    </main>
  );
}
