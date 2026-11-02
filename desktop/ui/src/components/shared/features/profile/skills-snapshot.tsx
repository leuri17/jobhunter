import {
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardAction,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { Skill } from '@/lib/types';
import { SKILL_CATEGORIES, categoryLabel } from './category-labels';

export interface SkillsSnapshotProps {
  skills: readonly Skill[];
  onManage: () => void;
}

export function SkillsSnapshot({ skills, onManage }: SkillsSnapshotProps) {
  const groups = SKILL_CATEGORIES.map((category) => ({
    category,
    skills: skills.filter((s) => s.category === category),
  })).filter((g) => g.skills.length > 0);

  return (
    <>
      <CardHeader>
        <CardTitle>Extracted skills &amp; taxonomy</CardTitle>
        <CardDescription>Skills reconciled from all sources, grouped by category.</CardDescription>
        <CardAction>
          <Button variant="link" size="sm" onClick={onManage}>
            Manage skills →
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No skills yet — run extraction after adding a source.
          </p>
        ) : (
          <div className="rounded-md border bg-card/50 p-3.5">
            {groups.map(({ category, skills: groupSkills }, i) => (
              <div key={category} className={i === 0 ? '' : 'border-t pt-2.5'}>
                <span className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                  {categoryLabel(category)} ({groupSkills.length})
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {groupSkills.map((s) => (
                    <Badge
                      key={s.id}
                      variant="outline"
                      className="rounded-sm px-2 py-0.5 text-[11px]"
                    >
                      {s.name}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </>
  );
}
