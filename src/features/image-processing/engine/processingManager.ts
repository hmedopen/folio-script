/**
 * Folio Script — Image Merge & Cut System
 * Processing Session Manager & Lifecycle Controller
 */

import type {
  ProcessingSession,
  ProcessingSourceImage,
  ProcessingOutput,
  ProcessingOperation,
  MergeOptions,
  CutOptions,
  BoundaryIntegrityStatus,
} from '../core/types';
import {
  calculateAutomaticMergeGroups,
  executeMergeJob,
  renderSingleMergedOutput,
} from './mergeEngine';
import {
  calculateAutomaticCutSegments,
  executeCutJob,
  renderSingleCutOutput,
} from './cutEngine';
import {
  checkBoundaryIntegrity,
  captureAllocationSnapshot,
  setOutputContributions,
  reassignSourceImage,
} from '../core/allocationModel';

export class ProcessingManager {
  private session: ProcessingSession | null = null;
  private abortController: AbortController | null = null;
  private subscribers = new Set<(session: ProcessingSession) => void>();

  public subscribe(fn: (session: ProcessingSession) => void): () => void {
    this.subscribers.add(fn);
    if (this.session) fn(this.session);
    return () => this.subscribers.delete(fn);
  }

  public getSession(): ProcessingSession | null {
    return this.session;
  }

  private notify(): void {
    if (!this.session) return;
    const snap = { ...this.session };
    for (const sub of this.subscribers) {
      try {
        sub(snap);
      } catch (err) {
        console.error('[ProcessingManager] Subscriber error:', err);
      }
    }
  }

  /**
   * Initializes a new session with source images.
   */
  public initSession(
    context: 'fetch' | 'upload',
    title: string,
    sourceImages: ProcessingSourceImage[]
  ): ProcessingSession {
    this.cleanupSession();
    this.session = {
      id: `proc-session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      context,
      title,
      sourceImages,
      outputs: [],
      history: [],
      status: 'idle',
      progress: { current: 0, total: 0, message: 'Ready' },
    };
    this.notify();
    return this.session;
  }

  /**
   * Starts an automated Merge job.
   */
  public async runMerge(options?: MergeOptions): Promise<ProcessingOutput[]> {
    if (!this.session || this.session.sourceImages.length === 0) {
      throw new Error('No source images loaded in session.');
    }

    this.cancel();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Calculate grouping
    const initialOutputs = calculateAutomaticMergeGroups(this.session.sourceImages, options);
    this.session.outputs = initialOutputs;
    this.session.history = [captureAllocationSnapshot(initialOutputs)];
    this.session.status = 'processing';
    this.notify();

    try {
      const renderedOutputs = await executeMergeJob(
        initialOutputs,
        this.session.sourceImages,
        (progress) => {
          if (this.session) {
            this.session.progress = progress;
            this.notify();
          }
        },
        signal
      );

      this.session.outputs = renderedOutputs;
      this.session.status = 'ready';
      this.notify();
      return renderedOutputs;
    } catch (err: any) {
      if (signal.aborted) {
        this.session.status = 'idle';
      } else {
        this.session.status = 'failed';
        this.session.errorMessage = err?.message || 'Merge processing failed.';
      }
      this.notify();
      throw err;
    }
  }

  /**
   * Starts an automated Cut job.
   */
  public async runCut(options?: CutOptions): Promise<ProcessingOutput[]> {
    if (!this.session || this.session.sourceImages.length === 0) {
      throw new Error('No source images loaded in session.');
    }

    this.cancel();
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const initialOutputs = calculateAutomaticCutSegments(this.session.sourceImages, options);
    this.session.outputs = initialOutputs;
    this.session.history = [captureAllocationSnapshot(initialOutputs)];
    this.session.status = 'processing';
    this.notify();

    try {
      const renderedOutputs = await executeCutJob(
        initialOutputs,
        this.session.sourceImages,
        (progress) => {
          if (this.session) {
            this.session.progress = progress;
            this.notify();
          }
        },
        signal
      );

      this.session.outputs = renderedOutputs;
      this.session.status = 'ready';
      this.notify();
      return renderedOutputs;
    } catch (err: any) {
      if (signal.aborted) {
        this.session.status = 'idle';
      } else {
        this.session.status = 'failed';
        this.session.errorMessage = err?.message || 'Cut processing failed.';
      }
      this.notify();
      throw err;
    }
  }

  /**
   * Evaluates boundary integrity of current session.
   */
  public getBoundaryStatus(): BoundaryIntegrityStatus {
    if (!this.session) {
      return {
        unassignedSourceIds: [],
        duplicateSourceIds: [],
        gaps: [],
        emptyOutputIds: [],
        isValid: true,
      };
    }
    return checkBoundaryIntegrity(this.session.sourceImages, this.session.outputs);
  }

  /**
   * Updates source allocations for an output and regenerates affected outputs.
   */
  public async updateOutputAllocation(
    targetOutputId: string,
    newSourceIds: string[]
  ): Promise<void> {
    if (!this.session) return;

    // Record snapshot in history for undo
    this.session.history.push(captureAllocationSnapshot(this.session.outputs));

    const updatedOutputs = setOutputContributions(
      this.session.outputs,
      this.session.sourceImages,
      targetOutputId,
      newSourceIds,
      true
    );

    this.session.outputs = updatedOutputs;
    this.notify();

    // Rebuild only outputs that have pending status
    await this.rebuildPendingOutputs();
  }

  /**
   * Reassigns a specific source image to an output and regenerates affected outputs.
   */
  public async reassignSource(
    sourceImageId: string,
    targetOutputId: string
  ): Promise<void> {
    if (!this.session) return;

    this.session.history.push(captureAllocationSnapshot(this.session.outputs));

    const updatedOutputs = reassignSourceImage(
      this.session.outputs,
      this.session.sourceImages,
      sourceImageId,
      targetOutputId,
      true
    );

    this.session.outputs = updatedOutputs;
    this.notify();

    await this.rebuildPendingOutputs();
  }

  /**
   * Undo previous allocation change.
   */
  public async undoAllocation(): Promise<boolean> {
    if (!this.session || this.session.history.length === 0) return false;

    const previousSnapshot = this.session.history.pop();
    if (!previousSnapshot) return false;

    this.session.outputs = this.session.outputs.map((out, idx) => {
      const snapContribs = previousSnapshot[idx] || [];
      return {
        ...out,
        contributingSources: snapContribs.map((c) => ({ ...c })),
        status: 'pending',
      };
    });

    this.notify();
    await this.rebuildPendingOutputs();
    return true;
  }

  /**
   * Re-renders any outputs marked as pending.
   */
  private async rebuildPendingOutputs(): Promise<void> {
    if (!this.session) return;

    for (let i = 0; i < this.session.outputs.length; i++) {
      const out = this.session.outputs[i];
      if (out.status === 'pending') {
        // Revoke previous preview URL if any
        if (out.previewUrl) {
          try {
            URL.revokeObjectURL(out.previewUrl);
          } catch {}
        }

        let updated: ProcessingOutput;
        if (out.operation === 'merge') {
          updated = await renderSingleMergedOutput(out, this.session.sourceImages);
        } else {
          updated = await renderSingleCutOutput(out, this.session.sourceImages);
        }
        this.session.outputs[i] = updated;
      }
    }

    this.notify();
  }

  public cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  public cleanupSession(): void {
    this.cancel();
    if (this.session) {
      for (const out of this.session.outputs) {
        if (out.previewUrl) {
          try {
            URL.revokeObjectURL(out.previewUrl);
          } catch {}
        }
      }
      for (const src of this.session.sourceImages) {
        if (src.thumbnailUrl) {
          try {
            URL.revokeObjectURL(src.thumbnailUrl);
          } catch {}
        }
      }
      this.session = null;
    }
  }
}

export const processingManager = new ProcessingManager();
