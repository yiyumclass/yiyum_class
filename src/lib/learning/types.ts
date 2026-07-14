export type CourseLesson = {
  id: string;
  title: string;
  durationSeconds: number;
  videoSrc?: string;
};

export type CourseSection = {
  id: string;
  title: string;
  description: string;
  lessons: CourseLesson[];
};

export type Course = {
  slug: string;
  title: string;
  shortTitle: string;
  description: string;
  instructor: string;
  posterSrc: string;
  sections: CourseSection[];
};

export type CourseProgress = {
  currentLessonId: string;
  completedLessonIds: string[];
  positionsByLessonId: Record<string, number>;
  lastWatchedAt: string | null;
  lastCompletedLessonId: string | null;
};
