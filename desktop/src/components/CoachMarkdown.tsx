import { memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
const plugins = [remarkGfm];
export const CoachMarkdown = memo(function CoachMarkdown({
  text,
}: {
  text: string;
}) {
  return (
    <div className="coach-markdown">
      <Markdown
        remarkPlugins={plugins}
        skipHtml
        disallowedElements={["img", "input"]}
        components={{ a: ({ children }) => <span>{children}</span> }}
      >
        {text}
      </Markdown>
    </div>
  );
});
