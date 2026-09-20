import { Label } from '../ui/label.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select.js';

/** The first entry is always `~/.claude`, the host's own default. */
export function LaunchConfigDirPicker({
  dirs,
  value,
  onChange,
}: {
  dirs: string[];
  value: string;
  onChange: (token: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor="launch-config-dir">Claude config</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger
          id="launch-config-dir"
          aria-label="Claude config"
          className="w-full min-w-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {dirs.map((dir, i) => (
            <SelectItem key={dir} value={dir}>
              {i === 0 ? `${dir} (default)` : dir}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
