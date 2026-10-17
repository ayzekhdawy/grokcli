import { memo, useEffect, useState } from "react";
import { IconChevronDown } from "@/components/icons";
import { Tip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export const BackBottom = memo(function BackBottom({
  visible,
  subscribeVisible,
  alwaysVisible,
  onClick,
  label,
}: {
  visible?: boolean;
  subscribeVisible?: (cb: (val: boolean) => void) => () => void;
  alwaysVisible?: boolean;
  onClick: () => void;
  label: string;
}) {
  const [internalVisible, setInternalVisible] = useState(!!visible);

  useEffect(() => {
    if (!subscribeVisible) {
      setInternalVisible(!!visible);
      return;
    }
    return subscribeVisible((val) => {
      setInternalVisible(val);
    });
  }, [subscribeVisible, visible]);

  const isVisible = alwaysVisible || internalVisible;

  return (
    <Tip label={label}>
      <button
        type="button"
        className={cn("lobe-chat-back-bottom", isVisible && "is-visible")}
        aria-label={label}
        onClick={onClick}
      >
        <IconChevronDown size={18} />
      </button>
    </Tip>
  );
});
