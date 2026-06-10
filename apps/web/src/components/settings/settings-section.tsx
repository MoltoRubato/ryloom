import { cn } from "@/lib/utils";

type SettingsSectionProps = {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** Right-aligned footer area, typically a Save button. */
  footer?: React.ReactNode;
  className?: string;
};

export function SettingsSection({
  title,
  description,
  children,
  footer,
  className,
}: SettingsSectionProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="border-b border-border px-6 py-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="px-6 py-5">{children}</div>
      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-muted/40 px-6 py-3">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

type SettingsRowProps = {
  label: string;
  description?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
};

/** A label + control row used inside a SettingsSection. */
export function SettingsRow({
  label,
  description,
  htmlFor,
  children,
  className,
}: SettingsRowProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-8",
        className,
      )}
    >
      <div className="max-w-md">
        <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
          {label}
        </label>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:max-w-sm sm:flex-1 sm:justify-end">
        {children}
      </div>
    </div>
  );
}
