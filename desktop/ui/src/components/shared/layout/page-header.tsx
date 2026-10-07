import { createContext, forwardRef, useContext } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from 'cn';
import { Link } from '@tanstack/react-router';

const PageHeaderContext = createContext<null | undefined>(undefined);

const usePageHeaderContext = () => {
  const context = useContext(PageHeaderContext);

  if (context === undefined)
    throw new Error('PageHeader subcomponents must be used within PageHeader');

  return context;
};

// --- Root Component (Exported as PageHeader) ---
const PageHeader = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    return (
      <PageHeaderContext.Provider value={null}>
        <div ref={ref} className={cn('flex items-center justify-between', className)} {...props}>
          {children}
        </div>
      </PageHeaderContext.Provider>
    );
  },
);
PageHeader.displayName = 'PageHeader';

// --- Title Component ---
interface PageHeaderTitleProps extends React.HTMLAttributes<HTMLDivElement> {
  subtitle?: string;
}

const PageHeaderTitle = forwardRef<HTMLDivElement, PageHeaderTitleProps>(
  ({ subtitle, children, ...props }, ref) => {
    usePageHeaderContext();

    return (
      <div ref={ref} {...props}>
        <h1 className="text-2xl font-semibold">{children}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    );
  },
);
PageHeaderTitle.displayName = 'PageHeaderTitle';

// --- Action Component ---
interface LinkActionProps extends React.ComponentPropsWithoutRef<typeof Link> {
  type: 'link';
}

interface ButtonActionProps extends React.ComponentPropsWithoutRef<typeof Button> {
  type: 'button';
}

type PageHeaderActionProps = LinkActionProps | ButtonActionProps;

const PageHeaderAction = forwardRef<HTMLButtonElement | HTMLAnchorElement, PageHeaderActionProps>(
  ({ type, className, children, ...props }, ref) => {
    usePageHeaderContext();

    if (type === 'link') {
      return (
        <Link
          ref={ref as React.Ref<HTMLAnchorElement>}
          className={cn(buttonVariants({ size: 'lg' }), className)}
          {...(props as LinkActionProps)}
        >
          {children}
        </Link>
      );
    }

    if (type === 'button') {
      return (
        <Button
          ref={ref as React.Ref<HTMLButtonElement>}
          className={className}
          {...(props as ButtonActionProps)}
        >
          {children}
        </Button>
      );
    }

    return null;
  },
);
PageHeaderAction.displayName = 'PageHeaderAction';

export { PageHeader, PageHeaderAction, PageHeaderTitle };
