type BaseLibraryItem = {
  id: string;
  title: string;
  description: string;
  statusLabel: string;
  accessLabel: string;
  lastActivity: string;
  lastActivityAt: string | null;
  ctaLabel: string;
};

export type CourseLibraryItem = BaseLibraryItem & {
  kind: "course";
  href: string;
  status: "preparing" | "not-started" | "in-progress" | "completed";
  progress: number;
  completedLessons: number;
  totalLessons: number;
  currentLessonLabel: string;
  currentLessonProgress: number;
  recentCompletedLessonLabel: string | null;
};

export type EbookLibraryItem = BaseLibraryItem & {
  kind: "ebook";
  status: "preparing" | "available" | "completed";
};

/** 컨설팅은 재생할 것도 내려받을 것도 없다. 예약이 어디까지 갔는지만 보여준다. */
export type ConsultingLibraryItem = BaseLibraryItem & {
  kind: "consulting";
  status: "preparing" | "available" | "completed";
};

export type LibraryItem =
  | CourseLibraryItem
  | EbookLibraryItem
  | ConsultingLibraryItem;
