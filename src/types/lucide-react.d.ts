declare module "lucide-react" {
  import { SVGProps, ForwardRefExoticComponent, RefAttributes } from "react";

  export interface LucideIconProps extends SVGProps<SVGSVGElement> {
    size?: number;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    color?: string;
    className?: string;
  }

  export type LucideIcon = ForwardRefExoticComponent<
    LucideIconProps & RefAttributes<SVGSVGElement>
  >;

  // Existing icons
  export const Zap: LucideIcon;
  export const Play: LucideIcon;
  export const Square: LucideIcon;
  export const Plus: LucideIcon;
  export const Trash2: LucideIcon;
  export const RefreshCw: LucideIcon;
  export const Copy: LucideIcon;
  export const Check: LucideIcon;
  export const KeyRound: LucideIcon;
  export const ShoppingCart: LucideIcon;
  export const ChevronDown: LucideIcon;
  export const ChevronUp: LucideIcon;
  export const Settings: LucideIcon;
  export const Shield: LucideIcon;
  export const User: LucideIcon;
  export const CreditCard: LucideIcon;
  export const Clock: LucideIcon;
  export const Bell: LucideIcon;
  export const Palette: LucideIcon;
  export const Languages: LucideIcon;
  export const Sparkles: LucideIcon;
  export const ShieldCheck: LucideIcon;
  export const Bot: LucideIcon;
  export const Lock: LucideIcon;
  export const Send: LucideIcon;
  export const Globe: LucideIcon;
  export const MessageSquare: LucideIcon;
  export const Wifi: LucideIcon;

  // Missing icons from error messages
  export const Bitcoin: LucideIcon;
  export const ArrowLeft: LucideIcon;
  export const ChevronRight: LucideIcon;
  export const MoreHorizontal: LucideIcon;
  export const ChevronLeftIcon: LucideIcon;
  export const ChevronRightIcon: LucideIcon;
  export const ChevronDownIcon: LucideIcon;
  export const ArrowRight: LucideIcon;
  export const Search: LucideIcon;
  export const Circle: LucideIcon;
  export const X: LucideIcon;
  export const Minus: LucideIcon;
  export const GripVertical: LucideIcon;
  export const PanelLeft: LucideIcon;
  export const Power: LucideIcon;
  export const ScrollText: LucideIcon;
  export const Receipt: LucideIcon;
  export const LifeBuoy: LucideIcon;
  export const LogOut: LucideIcon;
  export const Calendar: LucideIcon;
  export const Puzzle: LucideIcon;
  export const Filter: LucideIcon;
  export const Package: LucideIcon;
  export const Timer: LucideIcon;
  export const ExternalLink: LucideIcon;
  export const LayoutGrid: LucideIcon;
  export const ChevronLeft: LucideIcon;
  export const MessageCircle: LucideIcon;
}
