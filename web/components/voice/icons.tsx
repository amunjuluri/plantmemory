import type { ComponentProps } from "react";

/** Voice icons drawn for this panel: 24px grid, 1.75 stroke, round ends. */
function Icon({ children, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** Start a voice conversation. */
export function VoiceIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M4 10.5v3M8 7.5v9M12 4.5v15M16 7.5v9M20 10.5v3" />
    </Icon>
  );
}

export function MicIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </Icon>
  );
}

export function MicOffIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M15 9.5V6a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 4.9 2.3" />
      <path d="M18.5 11a6.5 6.5 0 0 1-.9 3.3M5.5 11a6.5 6.5 0 0 0 10.4 5.2M12 17.5V21M4 4l16 16" />
    </Icon>
  );
}

export function KeyboardIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <rect x="3" y="6" width="18" height="12" rx="3" />
      <path d="M7 10h.01M10.33 10h.01M13.67 10h.01M17 10h.01M8.5 14h7" />
    </Icon>
  );
}

/** Show the written conversation. */
export function TranscriptIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="3.5" />
      <path d="M7 10.5h3.5M13.5 10.5H17M7 14h10" />
    </Icon>
  );
}

export function CloseIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M7 7l10 10M17 7 7 17" />
    </Icon>
  );
}

export function SendIcon(props: ComponentProps<"svg">) {
  return (
    <Icon {...props}>
      <path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" />
    </Icon>
  );
}
