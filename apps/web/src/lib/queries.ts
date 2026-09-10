import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { OwnerSummary, PageMeta, ProgressSummaryDto } from '@devpractice/contracts';
import { POLL_INTERVAL_MS } from '../config';
import { apiGet, apiGetPage, apiSend, newClientEventId } from './api';
import type {
  BookmarkDto,
  ChapterDetailDto,
  CurriculumDto,
  DueReviewsDto,
  ImportDraftDto,
  LessonDetailDto,
  MissionDetailDto,
  MissionSummaryDto,
  NoteDto,
  PlacementAssessmentDto,
  PlacementResultDto,
  ReleaseDto,
  ReviewResponseResultDto,
  SettingsDto,
  TodayDto,
} from './types';

/** Query keys in one place so invalidation after a mutation is exact. */
export const qk = {
  me: ['me'] as const,
  today: ['today'] as const,
  curriculum: ['curriculum'] as const,
  chapter: (id: string) => ['chapter', id] as const,
  lesson: (id: string) => ['lesson', id] as const,
  reviewsDue: ['reviews', 'due'] as const,
  progress: ['progress'] as const,
  notes: (q: string) => ['notes', q] as const,
  bookmarks: ['bookmarks'] as const,
  missions: ['missions'] as const,
  mission: (id: string) => ['mission', id] as const,
  placement: (chapterId: string) => ['placement', chapterId] as const,
  releases: ['content', 'releases'] as const,
  settings: ['settings'] as const,
};

/**
 * Poll only while the document is visible (spec 9.4) — a background tab must
 * not keep hitting the API.
 */
function visiblePolling(): number | false {
  return typeof document !== 'undefined' && document.visibilityState === 'visible'
    ? POLL_INTERVAL_MS
    : false;
}

export function useMe(): UseQueryResult<OwnerSummary> {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => apiGet<OwnerSummary>('/auth/me'),
    retry: false,
    staleTime: 30_000,
  });
}

export function useToday(): UseQueryResult<TodayDto> {
  return useQuery({
    queryKey: qk.today,
    queryFn: () => apiGet<TodayDto>('/today'),
    refetchInterval: visiblePolling,
    refetchIntervalInBackground: false,
  });
}

export function useCurriculum(): UseQueryResult<CurriculumDto> {
  return useQuery({ queryKey: qk.curriculum, queryFn: () => apiGet<CurriculumDto>('/curriculum') });
}

export function useChapter(id: string): UseQueryResult<ChapterDetailDto> {
  return useQuery({
    queryKey: qk.chapter(id),
    queryFn: () => apiGet<ChapterDetailDto>(`/chapters/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });
}

export function useLesson(id: string): UseQueryResult<LessonDetailDto> {
  return useQuery({
    queryKey: qk.lesson(id),
    queryFn: () => apiGet<LessonDetailDto>(`/lessons/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });
}

export function useProgress(): UseQueryResult<ProgressSummaryDto> {
  return useQuery({
    queryKey: qk.progress,
    queryFn: () => apiGet<ProgressSummaryDto>('/progress'),
    refetchInterval: visiblePolling,
    refetchIntervalInBackground: false,
  });
}

export function useDueReviews(): UseQueryResult<DueReviewsDto> {
  return useQuery({ queryKey: qk.reviewsDue, queryFn: () => apiGet<DueReviewsDto>('/reviews/due') });
}

export function useNotes(search: string): UseQueryResult<{ data: NoteDto[]; meta: PageMeta }> {
  return useQuery({
    queryKey: qk.notes(search),
    queryFn: () =>
      apiGetPage<NoteDto[]>(`/notes?limit=50${search ? `&q=${encodeURIComponent(search)}` : ''}`),
  });
}

export function useBookmarks(): UseQueryResult<BookmarkDto[]> {
  return useQuery({ queryKey: qk.bookmarks, queryFn: () => apiGet<BookmarkDto[]>('/bookmarks') });
}

export function useMissions(): UseQueryResult<MissionSummaryDto[]> {
  return useQuery({ queryKey: qk.missions, queryFn: () => apiGet<MissionSummaryDto[]>('/missions') });
}

export function useMission(id: string): UseQueryResult<MissionDetailDto> {
  return useQuery({
    queryKey: qk.mission(id),
    queryFn: () => apiGet<MissionDetailDto>(`/missions/${encodeURIComponent(id)}`),
    enabled: Boolean(id),
  });
}

export function usePlacement(chapterId: string): UseQueryResult<PlacementAssessmentDto> {
  return useQuery({
    queryKey: qk.placement(chapterId),
    queryFn: () => apiGet<PlacementAssessmentDto>(`/placements/${encodeURIComponent(chapterId)}`),
    enabled: Boolean(chapterId),
    // Never cache an assessment across attempts.
    gcTime: 0,
    staleTime: 0,
  });
}

export function useReleases(): UseQueryResult<ReleaseDto[]> {
  return useQuery({ queryKey: qk.releases, queryFn: () => apiGet<ReleaseDto[]>('/content/releases') });
}

export function useSettings(): UseQueryResult<SettingsDto> {
  return useQuery({ queryKey: qk.settings, queryFn: () => apiGet<SettingsDto>('/settings') });
}

/* ------------------------------- mutations ------------------------------- */

export function useCompleteLesson(lessonId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend<{ status: string; xpAwarded: number }>(
        'POST',
        `/lessons/${encodeURIComponent(lessonId)}/complete`,
        { clientEventId: newClientEventId(), acknowledgedReading: true },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.lesson(lessonId) });
      void client.invalidateQueries({ queryKey: qk.curriculum });
      void client.invalidateQueries({ queryKey: qk.progress });
      void client.invalidateQueries({ queryKey: qk.today });
    },
  });
}

export function useSkipLesson(lessonId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend<{ status: string }>('POST', `/lessons/${encodeURIComponent(lessonId)}/skip`, {
        clientEventId: newClientEventId(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.lesson(lessonId) });
      void client.invalidateQueries({ queryKey: qk.curriculum });
    },
  });
}

export function useEnrollReviewCards(lessonId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiSend<{ enrolled: number }>(
        'POST',
        `/lessons/${encodeURIComponent(lessonId)}/review-cards`,
        { clientEventId: newClientEventId() },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.lesson(lessonId) });
      void client.invalidateQueries({ queryKey: qk.reviewsDue });
    },
  });
}

export function useSubmitReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      cardId: string;
      cardVersionId: string;
      expectedRevision: number;
      rating: 'again' | 'hard' | 'good' | 'easy';
      selectedOptionIds?: string[];
    }) =>
      apiSend<ReviewResponseResultDto>(
        'POST',
        `/reviews/${encodeURIComponent(input.cardId)}/responses`,
        {
          clientEventId: newClientEventId(),
          cardVersionId: input.cardVersionId,
          expectedRevision: input.expectedRevision,
          rating: input.rating,
          ...(input.selectedOptionIds ? { selectedOptionIds: input.selectedOptionIds } : {}),
        },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.progress });
      void client.invalidateQueries({ queryKey: qk.today });
    },
  });
}

export function useSubmitPlacement(chapterId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      assessmentVersionId: string;
      answers: Record<string, { selectedOptionIds?: string[]; text?: string }>;
    }) =>
      apiSend<PlacementResultDto>('POST', `/placements/${encodeURIComponent(chapterId)}`, {
        clientEventId: newClientEventId(),
        assessmentVersionId: input.assessmentVersionId,
        answers: input.answers,
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.curriculum });
      void client.invalidateQueries({ queryKey: qk.chapter(chapterId) });
      void client.invalidateQueries({ queryKey: qk.progress });
    },
  });
}

export function useToggleBookmark() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { itemId: string; bookmarked: boolean }) =>
      apiSend<{ bookmarked: boolean }>(
        input.bookmarked ? 'DELETE' : 'PUT',
        `/bookmarks/${encodeURIComponent(input.itemId)}`,
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.bookmarks });
    },
  });
}

export function useRevealMissionHint(missionId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { revealKind: 'hint' | 'solution'; hintIndex?: number }) =>
      apiSend<{ content: string }>(
        'POST',
        `/missions/${encodeURIComponent(missionId)}/reveals`,
        {
          clientEventId: newClientEventId(),
          revealKind: input.revealKind,
          ...(input.hintIndex === undefined ? {} : { hintIndex: input.hintIndex }),
        },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: qk.mission(missionId) });
    },
  });
}

export function useImportContent() {
  return useMutation({
    mutationFn: (pkg: unknown) => apiSend<ImportDraftDto>('POST', '/content/imports', pkg),
  });
}

export function usePublishImport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { importId: string; checksum: string; baseReleaseId: string | null }) =>
      apiSend<ReleaseDto>('POST', `/content/imports/${encodeURIComponent(input.importId)}/publish`, {
        clientEventId: newClientEventId(),
        checksum: input.checksum,
        baseReleaseId: input.baseReleaseId,
      }),
    onSuccess: () => {
      void client.invalidateQueries();
    },
  });
}

export function useActivateRelease() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { releaseId: string; expectedRevision: number }) =>
      apiSend<ReleaseDto>(
        'POST',
        `/content/releases/${encodeURIComponent(input.releaseId)}/activate`,
        { clientEventId: newClientEventId(), expectedRevision: input.expectedRevision },
      ),
    onSuccess: () => {
      void client.invalidateQueries();
    },
  });
}
