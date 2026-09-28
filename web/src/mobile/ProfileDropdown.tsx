import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { LayoutGrid, Monitor, Settings2 } from "lucide-react";
import { Link } from "react-router";

export function ProfileDropdown({ open, onOpenChange, showScreen, container }: { open: boolean; onOpenChange: (open: boolean) => void; showScreen: boolean; container?: HTMLElement | null }) {
  return <DropdownMenu.Root open={open} onOpenChange={onOpenChange}>
    <DropdownMenu.Trigger className="m-icon-button m-profile-button" aria-label="Profile menu"><span aria-hidden="true">J</span></DropdownMenu.Trigger>
    <DropdownMenu.Portal container={container}>
      <DropdownMenu.Content className="m-dropdown" align="start" sideOffset={8} collisionPadding={12}>
        <DropdownMenu.Label className="m-dropdown-label">Jorge</DropdownMenu.Label>
        <DropdownMenu.Separator className="m-dropdown-separator" />
        <DropdownMenu.Item asChild><Link to="/m/board"><LayoutGrid size={17} aria-hidden="true" />Board</Link></DropdownMenu.Item>
        {showScreen && <DropdownMenu.Item asChild><Link to="/m/screen/samwise"><Monitor size={17} aria-hidden="true" />Screen</Link></DropdownMenu.Item>}
        <DropdownMenu.Item asChild><Link to="/m/settings"><Settings2 size={17} aria-hidden="true" />Settings</Link></DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
