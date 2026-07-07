import * as React from "react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "./ui/drawer";
import { ScrollArea } from "./ui/scroll-area";
import { cn } from "../lib/utils";

type RootSimpleKitModalProps = {
  children: React.ReactNode;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
};

type SimpleKitModalProps = {
  children: React.ReactNode;
  className?: string | undefined;
};

const desktop = "(min-width: 768px)";

function SimpleKitModal({ children, onOpenChange, open }: RootSimpleKitModalProps): React.JSX.Element {
  const isDesktop = useMediaQuery(desktop);
  const Modal = isDesktop ? Dialog : Drawer;
  const modalProps = {
    ...(open !== undefined ? { open } : {}),
    ...(onOpenChange ? { onOpenChange } : {}),
  };

  return <Modal {...modalProps}>{children}</Modal>;
}

function SimpleKitModalTrigger({ className, children }: SimpleKitModalProps): React.JSX.Element {
  const isDesktop = useMediaQuery(desktop);
  const ModalTrigger = isDesktop ? DialogTrigger : DrawerTrigger;

  return (
    <ModalTrigger className={className}>
      {children}
    </ModalTrigger>
  );
}

function SimpleKitModalClose({ className, children }: SimpleKitModalProps): React.JSX.Element {
  const isDesktop = useMediaQuery(desktop);
  const ModalClose = isDesktop ? DialogClose : DrawerClose;

  return (
    <ModalClose className={className}>
      {children}
    </ModalClose>
  );
}

function SimpleKitModalContent({ className, children }: SimpleKitModalProps): React.JSX.Element {
  const isDesktop = useMediaQuery(desktop);
  const ModalContent = isDesktop ? DialogContent : DrawerContent;

  return (
    <ModalContent className={cn("rounded-t-lg md:max-w-[380px] [&>button]:right-5 [&>button]:top-5", className)}>
      {children}
    </ModalContent>
  );
}

function SimpleKitModalDescription({ className, children }: SimpleKitModalProps): React.JSX.Element {
  const isDesktop = useMediaQuery(desktop);
  const ModalDescription = isDesktop ? DialogDescription : DrawerDescription;

  return (
    <ModalDescription className={className}>
      {children}
    </ModalDescription>
  );
}

function SimpleKitModalHeader({ className, children }: SimpleKitModalProps): React.JSX.Element {
  const isDesktop = useMediaQuery(desktop);
  const ModalHeader = isDesktop ? DialogHeader : DrawerHeader;

  return (
    <ModalHeader className={cn("space-y-0 pb-4", className)}>
      {children}
    </ModalHeader>
  );
}

function SimpleKitModalTitle({ className, children }: SimpleKitModalProps): React.JSX.Element {
  const isDesktop = useMediaQuery(desktop);
  const ModalTitle = isDesktop ? DialogTitle : DrawerTitle;

  return (
    <ModalTitle className={cn("text-center", className)}>
      {children}
    </ModalTitle>
  );
}

function SimpleKitModalBody({ className, children }: SimpleKitModalProps): React.JSX.Element {
  return (
    <ScrollArea className={cn("h-[250px] max-h-[50svh] px-6 md:h-full md:min-h-[260px] md:px-0", className)}>
      {children}
    </ScrollArea>
  );
}

function SimpleKitModalFooter({ className, children }: SimpleKitModalProps): React.JSX.Element {
  const isDesktop = useMediaQuery(desktop);
  const ModalFooter = isDesktop ? DialogFooter : DrawerFooter;

  return (
    <ModalFooter className={cn("py-4 md:py-0", className)}>
      {children}
    </ModalFooter>
  );
}

function useMediaQuery(query: string): boolean {
  const [value, setValue] = React.useState(false);

  React.useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => setValue(event.matches);

    setValue(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return value;
}

export {
  SimpleKitModal,
  SimpleKitModalBody,
  SimpleKitModalClose,
  SimpleKitModalContent,
  SimpleKitModalDescription,
  SimpleKitModalFooter,
  SimpleKitModalHeader,
  SimpleKitModalTitle,
  SimpleKitModalTrigger,
};
