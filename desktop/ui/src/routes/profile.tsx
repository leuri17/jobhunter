import { createRoute } from '@tanstack/react-router';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { PageHeader, PageHeaderTitle } from '@/components/shared/layout/page-header';
import { SectionDivider } from '@/components/shared/features/settings/search-config/section';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from '@/components/ui/toast';
import { ApiErrorDialog } from '@/components/shared/ui/api-error-dialog';
import { ACTION_GUIDANCE } from '@/lib/error-surfaces';
import { api, ApiError } from '@/lib/api';
import type { ProfessionalProfile, ProfileListEntry } from '@/lib/types';
import { Route as rootRoute } from './__root';
import { useProfileForm } from '@/components/shared/features/profile/profile-form-validator';
import {
  resolveWorkingCopy,
  type WorkingCopy,
} from '@/components/shared/features/profile/working-copy';
import { ProfileFooter } from '@/components/shared/features/profile/profile-footer';
import { StatusCard } from '@/components/shared/features/profile/status-card';
import { BasicsSection } from '@/components/shared/features/profile/basics-section';
import { TargetRolesSection } from '@/components/shared/features/profile/target-roles-section';
import { SourcesSection } from '@/components/shared/features/profile/sources-section';
import { SkillsSnapshot } from '@/components/shared/features/profile/skills-snapshot';
import { ExperienceSection } from '@/components/shared/features/profile/experience-section';
import { ProjectsSection } from '@/components/shared/features/profile/projects-section';
import { SkillsSection } from '@/components/shared/features/profile/skills-section';
import { LanguagesSection } from '@/components/shared/features/profile/languages-section';
import { EducationSection } from '@/components/shared/features/profile/education-section';
import { CertificationsSection } from '@/components/shared/features/profile/certifications-section';
import { ConflictsSection } from '@/components/shared/features/profile/conflicts-section';
import { VersionHistorySection } from '@/components/shared/features/profile/version-history-section';

const EXTRACT_FAILURE_ALERT_CODES = new Set([
  'openai_unavailable',
  'openai_authentication',
  'openai_permission',
  'openai_billing',
]);

const INVALIDATE_ON_APPROVE = [['profiles'], ['profile'], ['jobs'], ['runs']] as const;

type EditableWorkingCopy = Extract<WorkingCopy, { kind: 'draft' } | { kind: 'approved' }>;

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: ProfilePage,
  pendingComponent: ProfileSkeleton,
});

export function ProfilePage() {
  const list = useSuspenseQuery({ queryKey: ['profiles'], queryFn: () => api.listProfiles() });
  const workingCopy = resolveWorkingCopy(list.data.profiles);
  if (workingCopy.kind === 'none') {
    return <ProfileFirstRun profiles={list.data.profiles} />;
  }
  return <ProfileEditor workingCopy={workingCopy} />;
}

function StatusBadges({ workingCopy }: { workingCopy: EditableWorkingCopy }) {
  const list = useSuspenseQuery({ queryKey: ['profiles'], queryFn: () => api.listProfiles() });
  const activeApproved = list.data.profiles.find((p) => p.active && p.status === 'approved');
  return (
    <div className="flex items-center gap-2">
      {activeApproved !== undefined && (
        <Badge
          variant="outline"
          className="border-emerald-500/30 bg-emerald-500/10 font-mono text-[11px] tracking-wide text-emerald-400"
        >
          ACTIVE &amp; APPROVED · ver_{activeApproved.profileVersionId}
        </Badge>
      )}
      {workingCopy.kind === 'draft' && (
        <Badge
          variant="outline"
          className="border-amber-500/30 bg-amber-500/10 font-mono text-[11px] tracking-wide text-amber-400"
        >
          DRAFT · ver_{workingCopy.entry.profileVersionId}
        </Badge>
      )}
    </div>
  );
}

function ProfileEditor({ workingCopy }: { workingCopy: EditableWorkingCopy }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('overview');
  const [failure, setFailure] = useState<{ source: 'save' | 'extract'; error: ApiError } | null>(
    null,
  );
  const [confirmApprove, setConfirmApprove] = useState(false);

  const list = useSuspenseQuery({ queryKey: ['profiles'], queryFn: () => api.listProfiles() });
  const versionKey = `profile_${workingCopy.entry.profileVersionId}`;
  const detail = useSuspenseQuery({
    queryKey: ['profile', versionKey],
    queryFn: () => api.getProfile(versionKey),
  });
  const apiKey = useQuery({ queryKey: ['api-key'], queryFn: api.getApiKeyStatus });

  const form = useProfileForm({
    defaultValues: detail.data.profile,
    onSubmit: async ({ value }) => {
      try {
        const response = await api.editProfile(versionKey, value as ProfessionalProfile);
        await queryClient.invalidateQueries({ queryKey: ['profiles'] });
        const freshVersionKey = `profile_${response.profileVersionId}`;
        const fresh = await queryClient.fetchQuery({
          queryKey: ['profile', freshVersionKey],
          queryFn: () => api.getProfile(freshVersionKey),
        });
        form.reset(fresh.profile);
        toast.add({ title: `Draft saved — ver_${response.profileVersionId}`, type: 'success' });
      } catch (err: unknown) {
        setFailure({ source: 'save', error: err as ApiError });
      }
    },
  });

  // defaultValues are read once on first render; re-baseline whenever the
  // working copy's identity changes (derived draft after save, new draft
  // after extraction). Same-id refetches never clobber in-flight edits.
  const workingProfileId = detail.data.profile.id;
  useEffect(() => {
    form.reset(detail.data.profile);
  }, [workingProfileId]);

  const extract = useMutation({
    mutationFn: () => api.extractProfile(),
    onSuccess: async (response) => {
      if (response.status.kind === 'failed') {
        setFailure({
          source: 'extract',
          error: new ApiError(200, response.status.errorCode, response.status.message),
        });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['profile-sources'] });
      toast.add({ title: 'Extraction complete — new draft ready for review', type: 'success' });
      setActiveTab('overview');
    },
    onError: (err) => {
      setFailure({ source: 'extract', error: err as ApiError });
    },
  });

  const approve = useMutation({
    mutationFn: () => api.approveProfile(`profile_${workingCopy.entry.profileVersionId}`),
    onSuccess: () => {
      for (const key of INVALIDATE_ON_APPROVE) {
        void queryClient.invalidateQueries({ queryKey: [...key] });
      }
      toast.add({ title: 'Version approved — profile is live', type: 'success' });
    },
    onError: (err) => {
      setFailure({ source: 'save', error: err as ApiError });
    },
  });

  const blockingCount = detail.data.warnings.filter(
    (w) => w.severity === 'blocking_conflict',
  ).length;
  const warningCount = detail.data.warnings.length - blockingCount;
  const issueCount = detail.data.conflicts.length + detail.data.warnings.length;
  const showExtractAlert =
    failure !== null &&
    failure.source === 'extract' &&
    EXTRACT_FAILURE_ALERT_CODES.has(failure.error.code) &&
    !extract.isPending;

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderTitle subtitle="Canonical resume profile, document ingestion, and version approval.">
          Profile
        </PageHeaderTitle>
      </PageHeader>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList variant="line">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="experience">Experience</TabsTrigger>
            <TabsTrigger value="skills">Skills</TabsTrigger>
            <TabsTrigger value="education">Education</TabsTrigger>
            <TabsTrigger value="conflicts" aria-label={`Conflicts, ${issueCount} open`}>
              Conflicts
              <Badge
                variant={blockingCount > 0 ? 'destructive' : 'secondary'}
                className="text-[11px]"
              >
                {issueCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="history">Version history</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Card>
              <form.Subscribe selector={(s) => s.values}>
                {(profile) => (
                  <>
                    <StatusCard
                      profile={profile as ProfessionalProfile}
                      badges={<StatusBadges workingCopy={workingCopy} />}
                      sourcesReady={0}
                    />
                    <SectionDivider />
                    <BasicsSection form={form} />
                    <SectionDivider />
                    <TargetRolesSection form={form} />
                    <SectionDivider />
                    <SourcesSection disabled={extract.isPending} />
                    <SectionDivider />
                    <SkillsSnapshot
                      skills={(profile as ProfessionalProfile).skills}
                      onManage={() => setActiveTab('skills')}
                    />
                  </>
                )}
              </form.Subscribe>
            </Card>
          </TabsContent>
          <TabsContent value="experience">
            <Card>
              <ExperienceSection form={form} />
              <SectionDivider />
              <ProjectsSection form={form} />
            </Card>
          </TabsContent>
          <TabsContent value="skills">
            <Card>
              <SkillsSection form={form} />
              <SectionDivider />
              <LanguagesSection form={form} />
            </Card>
          </TabsContent>
          <TabsContent value="education">
            <Card>
              <EducationSection form={form} />
              <SectionDivider />
              <CertificationsSection form={form} />
            </Card>
          </TabsContent>
          <TabsContent value="conflicts">
            <Card>
              <ConflictsSection conflicts={detail.data.conflicts} warnings={detail.data.warnings} />
            </Card>
          </TabsContent>
          <TabsContent value="history">
            <Card>
              <VersionHistorySection
                profiles={list.data.profiles}
                blockingConflictCount={blockingCount}
              />
            </Card>
          </TabsContent>
        </Tabs>

        {showExtractAlert && (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>Extraction failed</AlertTitle>
            <AlertDescription>
              {failure?.error.message ?? ''}{' '}
              <Link to="/settings" className="underline underline-offset-4">
                Add your AI provider API key in Settings
              </Link>
            </AlertDescription>
          </Alert>
        )}

        <form.Subscribe selector={(s) => [s.isDirty, s.canSubmit, s.isSubmitting] as const}>
          {([isDirty, canSubmit, isSubmitting]) => (
            <ProfileFooter
              isDirty={isDirty}
              canSubmit={canSubmit}
              isSubmitting={isSubmitting}
              invalid={isDirty && !canSubmit}
              blockingCount={blockingCount}
              warningCount={warningCount}
              extracting={extract.isPending}
              apiKeyConfigured={apiKey.data?.configured ?? true}
              mode={isDirty ? 'dirty' : workingCopy.kind === 'draft' ? 'draft' : 'idle'}
              onSave={() => void form.handleSubmit()}
              onDiscard={() => form.reset(detail.data.profile)}
              onRunExtraction={() => extract.mutate()}
              onApprove={() => setConfirmApprove(true)}
              onGoToConflicts={() => setActiveTab('conflicts')}
            />
          )}
        </form.Subscribe>
      </form>

      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Approve version ver_{workingCopy.entry.profileVersionId}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the current active profile used for job scoring. The previous active
              version becomes superseded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmApprove(false);
                approve.mutate();
              }}
            >
              Approve &amp; publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ApiErrorDialog
        error={failure?.error ?? null}
        title={failure?.source === 'extract' ? 'Extraction failed' : "Couldn't save profile"}
        guidance={
          failure?.source === 'extract'
            ? ACTION_GUIDANCE.profileExtraction
            : ACTION_GUIDANCE.profileSave
        }
        onAction={() => {
          const source = failure?.source;
          setFailure(null);
          if (source === 'extract') {
            extract.mutate();
          } else {
            void form.handleSubmit();
          }
        }}
        onDismiss={() => setFailure(null)}
      />
    </div>
  );
}

function ProfileFirstRun({ profiles }: { profiles: readonly ProfileListEntry[] }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('overview');
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const addSourceRef = useRef<(() => void) | null>(null);

  const sources = useQuery({ queryKey: ['profile-sources'], queryFn: api.listSources });
  const apiKey = useQuery({ queryKey: ['api-key'], queryFn: api.getApiKeyStatus });

  const extract = useMutation({
    mutationFn: () => api.extractProfile(),
    onSuccess: async (response) => {
      if (response.status.kind === 'failed') {
        setSaveError(new ApiError(200, response.status.errorCode, response.status.message));
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['profile-sources'] });
      toast.add({ title: 'Extraction complete — new draft ready for review', type: 'success' });
      setActiveTab('overview');
    },
    onError: (err) => {
      setSaveError(err as ApiError);
    },
  });

  const sourceCount = sources.data?.sources.length ?? 0;
  const showExtractAlert =
    saveError !== null && EXTRACT_FAILURE_ALERT_CODES.has(saveError.code) && !extract.isPending;

  if (sourceCount === 0) {
    return (
      <div className="space-y-6">
        <PageHeader>
          <PageHeaderTitle subtitle="Canonical resume profile, document ingestion, and version approval.">
            Profile
          </PageHeaderTitle>
        </PageHeader>
        <Card>
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>
              Add up to two CV or resume files. JobHunter builds your profile from them — you review
              and approve every version.
            </CardDescription>
          </CardHeader>
          <SectionDivider />
          <SourcesSection disabled={extract.isPending} addTriggerRef={addSourceRef} />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderTitle subtitle="Canonical resume profile, document ingestion, and version approval.">
          Profile
        </PageHeaderTitle>
      </PageHeader>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="experience">Experience</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="education">Education</TabsTrigger>
          <TabsTrigger value="conflicts" aria-label="Conflicts, 0 open">
            Conflicts
            <Badge variant="secondary" className="text-[11px]">
              0
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="history">Version history</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <Card>
            <StatusCard
              profile={null}
              badges={null}
              sourcesReady={sourceCount}
              onAddSource={() => addSourceRef.current?.()}
            />
            <SectionDivider />
            <SourcesSection disabled={extract.isPending} addTriggerRef={addSourceRef} />
          </Card>
        </TabsContent>
        <TabsContent value="experience">
          <Card>
            <p className="p-6 text-sm text-muted-foreground">
              No work experience yet. Run extraction after adding a source.
            </p>
          </Card>
        </TabsContent>
        <TabsContent value="skills">
          <Card>
            <p className="p-6 text-sm text-muted-foreground">
              No skills yet — run extraction after adding a source.
            </p>
          </Card>
        </TabsContent>
        <TabsContent value="education">
          <Card>
            <p className="p-6 text-sm text-muted-foreground">
              No education entries yet. Run extraction after adding a source.
            </p>
          </Card>
        </TabsContent>
        <TabsContent value="conflicts">
          <Card>
            <ConflictsSection conflicts={[]} warnings={[]} />
          </Card>
        </TabsContent>
        <TabsContent value="history">
          <Card>
            <VersionHistorySection profiles={profiles} blockingConflictCount={0} />
          </Card>
        </TabsContent>
      </Tabs>

      {showExtractAlert && (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Extraction failed</AlertTitle>
          <AlertDescription>
            {saveError.message}{' '}
            <Link to="/settings" className="underline underline-offset-4">
              Add your AI provider API key in Settings
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <ProfileFooter
        isDirty={false}
        canSubmit
        isSubmitting={false}
        invalid={false}
        blockingCount={0}
        warningCount={0}
        extracting={extract.isPending}
        apiKeyConfigured={apiKey.data?.configured ?? true}
        mode="idle"
        onSave={() => {}}
        onDiscard={() => {}}
        onRunExtraction={() => extract.mutate()}
        onApprove={() => {}}
        onGoToConflicts={() => setActiveTab('conflicts')}
      />

      <ApiErrorDialog
        error={saveError}
        title="Extraction failed"
        guidance={ACTION_GUIDANCE.profileExtraction}
        onAction={() => {
          setSaveError(null);
          extract.mutate();
        }}
        onDismiss={() => setSaveError(null)}
      />
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <PageHeader>
        <PageHeaderTitle subtitle="Canonical resume profile, document ingestion, and version approval.">
          Profile
        </PageHeaderTitle>
      </PageHeader>
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}
