import { parseLessonDescription } from "@/lib/learning/lesson-description";

export default function LessonDescription({
  description,
  className,
}: {
  description?: string;
  className?: string;
}) {
  const paragraphs = parseLessonDescription(description ?? "");
  if (paragraphs.length === 0) return null;

  return (
    <section className={className} aria-labelledby="lesson-description-title">
      <h2 id="lesson-description-title">강의 안내</h2>
      {paragraphs.map((parts, paragraphIndex) => (
        <p key={paragraphIndex}>
          {parts.map((part, partIndex) => part.type === "link" ? (
            <a key={partIndex} href={part.href} target="_blank" rel="noopener noreferrer">
              {part.text}
            </a>
          ) : part.text)}
        </p>
      ))}
    </section>
  );
}
