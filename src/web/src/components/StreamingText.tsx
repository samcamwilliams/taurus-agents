interface StreamingTextProps {
  text: string;
  done?: boolean;
}

export function StreamingText({ text, done }: StreamingTextProps) {
  return <div className={`llm-stream${done ? ' done' : ''}`}>{text}</div>;
}
