interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return <span className={`logo${className ? ` ${className}` : ''}`}>Taurus</span>;
}
