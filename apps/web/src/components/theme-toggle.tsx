'use client';
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import {
  Menu,
  MenuContent,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from './ui/menu';
import { Tooltip } from './ui/tooltip';

function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/** Light, dark or system, as menu radio items: the theme button's menu, and on phones the account menu's. */
export function ThemeItems() {
  const { theme, setTheme } = useTheme();
  const mounted = useMounted();
  return (
    <>
      <MenuLabel>Theme</MenuLabel>
      <MenuRadioGroup value={mounted ? (theme ?? 'system') : 'system'} onValueChange={setTheme}>
        <MenuRadioItem value="light">
          <SunIcon /> Light
        </MenuRadioItem>
        <MenuRadioItem value="dark">
          <MoonIcon /> Dark
        </MenuRadioItem>
        <MenuRadioItem value="system">
          <MonitorIcon /> System
        </MenuRadioItem>
      </MenuRadioGroup>
    </>
  );
}

export function ThemeToggle({ size = 'icon-sm' }: { size?: 'icon-sm' | 'icon' }) {
  const { resolvedTheme } = useTheme();
  const mounted = useMounted();
  const Icon = !mounted ? SunIcon : resolvedTheme === 'dark' ? MoonIcon : SunIcon;
  return (
    <Menu>
      <Tooltip label="Theme">
        <MenuTrigger asChild>
          <Button variant="ghost" size={size} aria-label="Change theme">
            <Icon />
          </Button>
        </MenuTrigger>
      </Tooltip>
      <MenuContent align="end" className="min-w-36">
        <ThemeItems />
      </MenuContent>
    </Menu>
  );
}
