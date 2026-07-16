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
  status: "available" | "completed";
};

export type LibraryItem = CourseLibraryItem | EbookLibraryItem;
