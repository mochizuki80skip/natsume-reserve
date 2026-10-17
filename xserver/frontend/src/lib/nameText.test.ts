import { describe, expect, it } from 'vitest';
import { dropHonorific, nameCheck } from './nameText';

describe('敬称（様）を外す', () => {
  it('後ろの様を外す', () => {
    expect(dropHonorific('山田太郎様')).toBe('山田太郎');
    expect(dropHonorific('山田 太郎 様')).toBe('山田 太郎');
    expect(dropHonorific('山田 太郎様（初診）')).toBe('山田 太郎（初診）');
    expect(dropHonorific('山田様(再来)')).toBe('山田(再来)');
  });
  it('そのほかはそのまま', () => {
    expect(dropHonorific('山田 太郎')).toBe('山田 太郎');
    expect(dropHonorific('上記初診対応')).toBe('上記初診対応');
    expect(dropHonorific('様子見 山田')).toBe('様子見 山田');
  });
});

describe('初回カルテの氏名の確認', () => {
  it('名字だけ', () => {
    expect(nameCheck('佐藤')?.kind).toBe('surname');
    expect(nameCheck('長谷川')?.kind).toBe('surname');
    expect(nameCheck('佐藤 太郎')).toBeNull();
    expect(nameCheck('佐藤太郎')).toBeNull();
  });
  it('ひらがなだけ', () => {
    expect(nameCheck('やまだ はなこ')?.kind).toBe('kana');
  });
  it('カタカナだけは外国の方かも', () => {
    expect(nameCheck('ジョン スミス')?.kind).toBe('foreign');
    expect(nameCheck('ｽﾐｽ')?.kind).toBe('foreign');
    expect(nameCheck('John Smith')?.kind).toBe('foreign');
    expect(nameCheck('山田 マリア')).toBeNull();
  });
});
