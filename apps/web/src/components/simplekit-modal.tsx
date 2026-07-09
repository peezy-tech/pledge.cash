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

type SimpleKitModalPartProps = {
  children: React.ReactNode;
  className?: string | undefined;
};

const DESKTOP_MEDIA_QUERY = "(min-width: 768px)";

function SimpleKitModal({ children, onOpenChange, open }: RootSimpleKitModalProps): React.JSX.Element {
  const { Root } = useSimpleKitModalComponents();
  const modalProps = modalControlProps({ onOpenChange, open });

  return <Root {...modalProps}>{children}</Root>;
}

function SimpleKitModalTrigger({ className, children }: SimpleKitModalPartProps): React.JSX.Element {
  const { Trigger } = useSimpleKitModalComponents();

  return (
    <Trigger className={className}>
      {children}
    </Trigger>
  );
}

function SimpleKitModalClose({ className, children }: SimpleKitModalPartProps): React.JSX.Element {
  const { Close } = useSimpleKitModalComponents();

  return (
    <Close className={className}>
      {children}
    </Close>
  );
}

function SimpleKitModalContent({ className, children }: SimpleKitModalPartProps): React.JSX.Element {
  const { Content } = useSimpleKitModalComponents();

  return (
    <Content className={cn("rounded-t-lg md:max-w-[380px] [&>button]:right-5 [&>button]:top-5", className)}>
      {children}
    </Content>
  );
}

function SimpleKitModalDescription({ className, children }: SimpleKitModalPartProps): React.JSX.Element {
  const { Description } = useSimpleKitModalComponents();

  return (
    <Description className={className}>
      {children}
    </Description>
  );
}

function SimpleKitModalHeader({ className, children }: SimpleKitModalPartProps): React.JSX.Element {
  const { Header } = useSimpleKitModalComponents();

  return (
    <Header className={cn("space-y-0 pb-4", className)}>
      {children}
    </Header>
  );
}

function SimpleKitModalTitle({ className, children }: SimpleKitModalPartProps): React.JSX.Element {
  const { Title } = useSimpleKitModalComponents();

  return (
    <Title className={cn("text-center", className)}>
      {children}
    </Title>
  );
}

function SimpleKitModalBody({ className, children }: SimpleKitModalPartProps): React.JSX.Element {
  return (
    <ScrollArea className={cn("h-[250px] max-h-[50svh] px-6 md:h-full md:min-h-[260px] md:px-0", className)}>
      {children}
    </ScrollArea>
  );
}

function SimpleKitModalFooter({ className, children }: SimpleKitModalPartProps): React.JSX.Element {
  const { Footer } = useSimpleKitModalComponents();

  return (
    <Footer className={cn("py-4 md:py-0", className)}>
      {children}
    </Footer>
  );
}

function modalControlProps({ onOpenChange, open }: Pick<RootSimpleKitModalProps, "onOpenChange" | "open">) {
  return {
    ...(open !== undefined ? { open } : {}),
    ...(onOpenChange ? { onOpenChange } : {}),
  };
}

function useSimpleKitModalComponents() {
  const isDesktop = useMediaQuery(DESKTOP_MEDIA_QUERY);

  return {
    Root: isDesktop ? Dialog : Drawer,
    Trigger: isDesktop ? DialogTrigger : DrawerTrigger,
    Close: isDesktop ? DialogClose : DrawerClose,
    Content: isDesktop ? DialogContent : DrawerContent,
    Description: isDesktop ? DialogDescription : DrawerDescription,
    Header: isDesktop ? DialogHeader : DrawerHeader,
    Title: isDesktop ? DialogTitle : DrawerTitle,
    Footer: isDesktop ? DialogFooter : DrawerFooter,
  };
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
