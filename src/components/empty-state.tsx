import Image from "next/image";

import { cn } from "@/lib/utils";

type Props = {
  icon?: React.ComponentType<React.ComponentProps<"svg">>;
  /** PNG em public/brand (line art monocromático; inverte no dark mode). */
  image?: string;
  title: string;
  description?: string;
  className?: string;
};

/** Estado vazio padronizado: ilustração (ou tile muted) + título + texto. */
export function EmptyState({ icon: Icon, image, title, description, className }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 rounded-md border border-dashed p-6 text-center",
        className,
      )}
    >
      {image ? (
        <span className="relative size-28">
          <Image
            src={image}
            alt=""
            fill
            sizes="112px"
            className="object-contain dark:invert"
          />
        </span>
      ) : (
        <span className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {Icon && <Icon className="size-5" />}
        </span>
      )}
      <p className="text-sm font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-xs text-balance text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
