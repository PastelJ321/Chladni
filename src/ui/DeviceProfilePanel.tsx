import { useEffect, useRef, useState } from 'react';
import type { Config } from '../experiment/types';
import { validateConfig } from '../experiment/config';
import {
  applyDeviceProfile,
  createDeviceProfile,
  DEVICE_PRESETS,
  deviceCalculationStatus,
  type DeviceProfile,
  type Measurement,
} from '../experiment/device';
import { loadDeviceAsset, disposeDeviceAsset, type LoadedDeviceAsset } from '../scene/deviceAsset';
import type { InstrumentAssetManifest } from '../scene/assetContract';

const sourceNames = {
  unknown: '미기록',
  measured: '실측',
  estimated: '추정',
  default: '설계 기본값',
};
function MeasurementField({
  label,
  m,
  onChange,
  scale = 1,
  unit = m.unit,
}: {
  label: string;
  m: Measurement;
  onChange: (m: Measurement) => void;
  scale?: number;
  unit?: string;
}) {
  return (
    <div className="device-measurement">
      <label>
        <span>{label}</span>
        <div className="measurement-value">
          <input
            aria-label={`장치 ${label}`}
            type="number"
            step="any"
            value={m.value === null ? '' : Number((m.value * scale).toPrecision(8))}
            placeholder="미기록"
            onChange={(e) =>
              onChange({
                ...m,
                value: e.target.value === '' ? null : +e.target.value / scale,
                source:
                  e.target.value === ''
                    ? 'unknown'
                    : m.source === 'unknown' || m.source === 'default'
                      ? 'estimated'
                      : m.source,
              })
            }
          />
          <small>{unit}</small>
        </div>
      </label>
      <details>
        <summary>
          {sourceNames[m.source]}
          {m.uncertainty !== null ? ` · ±${+(m.uncertainty * scale).toPrecision(5)} ${unit}` : ''}
        </summary>
        <label>
          출처
          <select
            aria-label={`${label} 출처`}
            value={m.source}
            onChange={(e) =>
              onChange({
                ...m,
                source: e.target.value as Measurement['source'],
                ...(e.target.value === 'unknown' ? { value: null } : {}),
              })
            }
          >
            {Object.entries(sourceNames).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          측정 불확도 ± ({unit})
          <input
            aria-label={`${label} 불확도`}
            type="number"
            min="0"
            step="any"
            placeholder="미기록"
            value={m.uncertainty === null ? '' : m.uncertainty * scale}
            onChange={(e) =>
              onChange({
                ...m,
                uncertainty: e.target.value === '' ? null : +e.target.value / scale,
              })
            }
          />
        </label>
        <label>
          측정 방법·출처
          <input
            aria-label={`${label} 측정 출처`}
            value={m.reference}
            placeholder="측정기·자료·추정 근거"
            onChange={(e) => onChange({ ...m, reference: e.target.value })}
          />
        </label>
        {['N/m', 'N·m/rad', 'N·s/m', 'kg'].includes(m.unit) && (
          <div className="field-grid">
            <label>
              추정 하한 ({unit})
              <input
                aria-label={`${label} 추정 하한`}
                type="number"
                step="any"
                value={m.range ? m.range[0] * scale : ''}
                onChange={(e) =>
                  onChange({
                    ...m,
                    range:
                      e.target.value === ''
                        ? undefined
                        : [
                            +e.target.value / scale,
                            m.range?.[1] ?? m.value ?? +e.target.value / scale,
                          ],
                  })
                }
              />
            </label>
            <label>
              추정 상한 ({unit})
              <input
                aria-label={`${label} 추정 상한`}
                type="number"
                step="any"
                value={m.range ? m.range[1] * scale : ''}
                onChange={(e) =>
                  onChange({
                    ...m,
                    range:
                      e.target.value === ''
                        ? undefined
                        : [
                            m.range?.[0] ?? m.value ?? +e.target.value / scale,
                            +e.target.value / scale,
                          ],
                  })
                }
              />
            </label>
          </div>
        )}
      </details>
    </div>
  );
}

export function DeviceProfilePanel({
  config,
  onChange,
  onAsset,
  onAssetClear,
  assetName,
}: {
  config: Config;
  onChange: (c: Config) => void;
  onAsset?: (asset: LoadedDeviceAsset) => void;
  onAssetClear?: () => void;
  assetName?: string;
}) {
  const [draft, setDraft] = useState(() =>
      structuredClone(config.device ?? createDeviceProfile('ideal', config.plate)),
    ),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [assetFile, setAssetFile] = useState<File | null>(null),
    [mapping, setMapping] = useState(''),
    [loading, setLoading] = useState(false);
  const photo = useRef<HTMLInputElement>(null),
    model = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(structuredClone(config.device ?? createDeviceProfile('ideal', config.plate)));
    setError('');
  }, [config.device]);
  const edit = (fn: (p: DeviceProfile) => void) => {
    setNotice('');
    setDraft((p) => {
      const n = structuredClone(p);
      fn(n);
      return n;
    });
  };
  function apply(p = draft) {
    try {
      const next = applyDeviceProfile(config, p);
      validateConfig(next);
      onChange(next);
      setError('');
      setNotice('장치 조건을 적용했습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  const measure = (
    section: 'plate' | 'connector' | 'speaker',
    key: string,
    label: string,
    scale = 1,
    unit?: string,
  ) => (
    <MeasurementField
      key={`${section}-${key}`}
      label={label}
      m={(draft[section] as unknown as Record<string, Measurement>)[key]}
      scale={scale}
      unit={unit}
      onChange={(m) =>
        edit((p) => {
          (p[section] as unknown as Record<string, Measurement>)[key] = m;
        })
      }
    />
  );
  const profiles = new Map<string, string>(DEVICE_PRESETS.map((p) => [p.id, p.label]));
  config.deviceLibrary?.forEach((p) => profiles.set(p.id, p.name));
  profiles.set(draft.id, draft.name);
  async function addPhoto(file?: File) {
    if (!file) return;
    if (
      !/^image\/(jpeg|png|webp)$/.test(file.type) ||
      file.size > 2 * 1024 * 1024 ||
      draft.evidence.length >= 6
    ) {
      setError('사진은 장당 2 MB 이하, 최대 6장입니다.');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    edit((p) => {
      p.evidence.push({
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        dataUrl,
      });
    });
    setNotice('사진을 추가했습니다. 장치 기록을 적용하면 세션에 함께 저장됩니다.');
  }
  function prepareAsset(file?: File) {
    if (!file) return;
    setAssetFile(file);
    setError('');
    const manifest: InstrumentAssetManifest = draft.asset?.manifest ?? {
      source: 'concept',
      reference: '',
      metersPerUnit: 1,
      construction: draft.construction,
      coordinates: 'Y-up-XZ-plate',
      nodes:
        draft.construction === 'adhesive'
          ? { plate: 'plate', coupler: 'coupler', speaker: 'speaker', support: 'support' }
          : {
              plate: 'plate',
              bolt: 'bolt',
              washerTop: 'washerTop',
              washerBottom: 'washerBottom',
              coupler: 'coupler',
              speaker: 'speaker',
              support: 'support',
            },
    };
    setMapping(JSON.stringify(manifest, null, 2));
  }
  async function importAsset() {
    if (!assetFile || !onAsset) return;
    setLoading(true);
    setError('');
    let loaded: LoadedDeviceAsset | null = null,
      delivered = false;
    try {
      const manifest = JSON.parse(mapping) as InstrumentAssetManifest;
      loaded = await loadDeviceAsset(assetFile, manifest);
      const p = structuredClone(draft);
      p.asset = { file: loaded.reference, manifest: loaded.manifest };
      const next = applyDeviceProfile(config, p);
      validateConfig(next);
      onAsset(loaded);
      delivered = true;
      onChange(next);
      setDraft(p);
      setNotice(
        '모델을 불러왔습니다. 형상은 장치 보기에서 관찰하며 FEM에는 장치 조건만 반영합니다.',
      );
      setAssetFile(null);
    } catch (e) {
      if (loaded && !delivered) disposeDeviceAsset(loaded);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="device-profile-panel">
      <label className="select-field">
        <span>장치 프로필</span>
        <select
          aria-label="장치 프로필"
          value={draft.id}
          onChange={(e) =>
            apply(
              config.deviceLibrary?.find((p) => p.id === e.target.value) ??
                createDeviceProfile(e.target.value, config.plate),
            )
          }
        >
          {Array.from(profiles).map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <div className="device-summary">
        <strong>
          {draft.kind === 'as-built'
            ? '실제 장치 기록'
            : draft.kind === 'proposal'
              ? '미제작 개선안'
              : '개념 장치'}
        </strong>
        <span>
          {draft.construction === 'adhesive' ? '무관통 판 · 접착/임시 연결' : '관통 체결 개념'}
        </span>
        <p>{deviceCalculationStatus(config.device ?? draft, config.plate.connection).label}</p>
      </div>
      <details className="device-editor">
        <summary>장치 기록·측정값</summary>
        <label>
          장치 이름
          <input
            aria-label="장치 이름"
            value={draft.name}
            onChange={(e) =>
              edit((p) => {
                p.name = e.target.value;
              })
            }
          />
        </label>
        <label>
          기록 날짜
          <input
            aria-label="장치 기록 날짜"
            type="date"
            value={draft.date ?? ''}
            onChange={(e) =>
              edit((p) => {
                p.date = e.target.value || null;
              })
            }
          />
        </label>
        <details open>
          <summary>진동판</summary>
          <p className="help">
            빈 항목은 미측정입니다. 계산에는 현재 설계값 {(config.plate.width * 1000).toFixed(0)}×
            {(config.plate.height * 1000).toFixed(0)}×{(config.plate.thickness * 1000).toFixed(2)}{' '}
            mm를 사용합니다.
          </p>
          <div className="field-grid">
            {measure('plate', 'width', '판 가로', 1000, 'mm')}
            {measure('plate', 'height', '판 세로', 1000, 'mm')}
            {measure('plate', 'thickness', '판 두께', 1000, 'mm')}
            {measure('plate', 'mass', '판 질량', 1000, 'g')}
          </div>
          <label>
            판 재료
            <select
              aria-label="장치 판 재료"
              value={draft.plate.material}
              onChange={(e) =>
                edit((p) => {
                  p.plate.material = e.target.value;
                })
              }
            >
              <option value="aluminum">알루미늄</option>
              <option value="steel">강철</option>
              <option value="brass">황동</option>
            </select>
          </label>
          <p className="help">판 질량 입력 시 치수와 질량으로 균일 등가 밀도를 계산합니다.</p>
        </details>
        <details>
          <summary>스피커·구동 경로</summary>
          <label>
            스피커 모델
            <input
              aria-label="스피커 모델"
              value={draft.speaker.model}
              placeholder="미확인"
              onChange={(e) =>
                edit((p) => {
                  p.speaker.model = e.target.value;
                })
              }
            />
          </label>
          <label>
            사양 출처
            <input
              aria-label="스피커 사양 출처"
              value={draft.speaker.reference}
              placeholder="모델 라벨·제조사 자료"
              onChange={(e) =>
                edit((p) => {
                  p.speaker.reference = e.target.value;
                })
              }
            />
          </label>
          {measure('speaker', 'power', '스피커 표기 전력')}
          {measure('speaker', 'impedance', '스피커 임피던스')}
          {measure('speaker', 'diameter', '스피커 지름', 1000, 'mm')}
          <p className="help">
            전기 입력에서 판 변위까지의 전달함수는 미보정입니다. 이 사양만으로 판 진폭을 추정하지
            않습니다.
          </p>
        </details>
        <details>
          <summary>연결부·기울기</summary>
          <label>
            연결 방식
            <select
              aria-label="장치 연결 방식"
              value={draft.construction}
              onChange={(e) =>
                edit((p) => {
                  p.construction = e.target.value as DeviceProfile['construction'];
                })
              }
            >
              <option value="adhesive">무관통 · 접착/임시 연결</option>
              <option value="bolted">관통 볼트 · 개념 체결</option>
            </select>
          </label>
          <label>
            고정·접착 기록
            <textarea
              aria-label="고정 접착 기록"
              value={draft.connector.attachment}
              onChange={(e) =>
                edit((p) => {
                  p.connector.attachment = e.target.value;
                })
              }
            />
          </label>
          <div className="field-grid">
            {measure('connector', 'length', '전달부 길이', 1000, 'mm')}
            {measure('connector', 'width', '전달부 단면 가로', 1000, 'mm')}
            {measure('connector', 'depth', '전달부 단면 세로', 1000, 'mm')}
            {measure('connector', 'positionX', '연결 위치 x/Lx')}
            {measure('connector', 'positionY', '연결 위치 y/Ly')}
            {measure('connector', 'contactWidth', '접촉 가로', 1000, 'mm')}
            {measure('connector', 'contactHeight', '접촉 세로', 1000, 'mm')}
          </div>
          <MeasurementField
            label="기울기 X"
            m={draft.tiltX}
            onChange={(m) =>
              edit((p) => {
                p.tiltX = m;
              })
            }
          />
          <MeasurementField
            label="기울기 Y"
            m={draft.tiltY}
            onChange={(m) =>
              edit((p) => {
                p.tiltY = m;
              })
            }
          />
          <label>
            지지 구조
            <textarea
              aria-label="지지 구조 기록"
              value={draft.support}
              onChange={(e) =>
                edit((p) => {
                  p.support = e.target.value;
                })
              }
            />
          </label>
          <p className="help">
            기울기·비대칭·접착 파손은 기록과 장면에만 반영합니다. 선형 판 해석에는 포함하지
            않습니다.
          </p>
        </details>
        <details>
          <summary>연결부 계산 가정</summary>
          <label>
            계산 모델
            <select
              aria-label="연결부 계산 가정"
              value={draft.calculationAssumption}
              onChange={(e) =>
                edit((p) => {
                  p.calculationAssumption = e.target
                    .value as DeviceProfile['calculationAssumption'];
                })
              }
            >
              <option value="ideal-reference">이상 고정 기준 · 실물 정합 아님</option>
              <option value="compliant">등가 스프링·댐퍼</option>
            </select>
          </label>
          <p className="help">
            유연 연결부는 강성 3개와 접촉 크기를 입력해야 적용됩니다. 미입력 감쇠·질량은 계산에서
            제외합니다.
          </p>
          {measure('connector', 'kz', '수직 강성')}
          {measure('connector', 'krx', '회전 강성 X')}
          {measure('connector', 'kry', '회전 강성 Y')}
          {measure('connector', 'cz', '수직 감쇠')}
          {measure('connector', 'crx', '회전 감쇠 X')}
          {measure('connector', 'cry', '회전 감쇠 Y')}
          {measure('connector', 'mass', '연결부 질량', 1000, 'g')}
        </details>
        <details>
          <summary>장치 사진 · {draft.evidence.length}</summary>
          <button type="button" onClick={() => photo.current?.click()}>
            사진 추가
          </button>
          <div className="device-photos">
            {draft.evidence.map((e) => (
              <figure key={e.id}>
                {e.dataUrl && <img src={e.dataUrl} alt={`장치 사진 ${e.name}`} />}
                <figcaption>
                  {e.name}
                  <button
                    aria-label={`${e.name} 사진 삭제`}
                    onClick={() =>
                      edit((p) => {
                        p.evidence = p.evidence.filter((x) => x.id !== e.id);
                      })
                    }
                  >
                    삭제
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </details>
        <label>
          장치 메모
          <textarea
            aria-label="장치 메모"
            value={draft.notes}
            onChange={(e) =>
              edit((p) => {
                p.notes = e.target.value;
              })
            }
          />
        </label>
        <button className="primary" onClick={() => apply()}>
          장치 기록 적용
        </button>
      </details>
      <details className="device-observations">
        <summary>예비실험·재현 기록</summary>
        {draft.observations.map((o, i) => (
          <article className="device-observation" key={o.id}>
            <strong>
              {o.particle}
              {o.frequency.value !== null ? ` · ${o.frequency.value} Hz` : ''}
            </strong>
            <p>{o.description}</p>
            <details>
              <summary>관찰 기록 편집</summary>
              <label>
                입자
                <input
                  aria-label={`관찰 ${i + 1} 입자`}
                  value={o.particle}
                  onChange={(e) =>
                    edit((p) => {
                      p.observations[i].particle = e.target.value;
                    })
                  }
                />
              </label>
              <label>
                관찰 내용
                <textarea
                  aria-label={`관찰 ${i + 1} 내용`}
                  value={o.description}
                  onChange={(e) =>
                    edit((p) => {
                      p.observations[i].description = e.target.value;
                    })
                  }
                />
              </label>
              <MeasurementField
                label={`관찰 ${i + 1} 주파수`}
                m={o.frequency}
                onChange={(m) =>
                  edit((p) => {
                    p.observations[i].frequency = m;
                  })
                }
              />
              <label>
                관찰 날짜
                <input
                  type="date"
                  aria-label={`관찰 ${i + 1} 날짜`}
                  value={o.date ?? ''}
                  onChange={(e) =>
                    edit((p) => {
                      p.observations[i].date = e.target.value || null;
                    })
                  }
                />
              </label>
              {o.source === 'observation' && (
                <button
                  onClick={() =>
                    edit((p) => {
                      p.observations.splice(i, 1);
                    })
                  }
                >
                  관찰 삭제
                </button>
              )}
            </details>
            <label>
              재현 여부
              <select
                aria-label={`${o.particle} 관찰 재현 여부`}
                value={o.reproduced}
                onChange={(e) =>
                  edit((p) => {
                    p.observations[i].reproduced = e.target.value as typeof o.reproduced;
                  })
                }
              >
                <option value="no">재현하지 못함</option>
                <option value="unconfirmed">확인 전</option>
                <option value="yes">재현 기록 있음</option>
              </select>
            </label>
            <small>
              {o.source === 'user-report' ? '사용자 제공 기록' : '직접 관찰'} ·{' '}
              {o.date ?? '날짜 미기록'}
            </small>
          </article>
        ))}
        <button
          onClick={() =>
            edit((p) => {
              p.observations.push({
                id: crypto.randomUUID(),
                particle: '입자 미기록',
                frequency: {
                  value: null,
                  source: 'unknown',
                  uncertainty: null,
                  unit: 'Hz',
                  reference: '',
                },
                description: '',
                reproduced: 'unconfirmed',
                date: null,
                source: 'observation',
              });
            })
          }
        >
          관찰 추가
        </button>
        <button onClick={() => apply()}>관찰 기록 적용</button>
      </details>
      <details className="device-asset">
        <summary>사진·CAD 모델 연결</summary>
        <p className="help">
          32 MB 이하 내장형 GLB/GLTF. Y-up·판 XZ 좌표와 부품 노드 이름을 확인하세요. 가져온 형상은
          구조 관찰용이며 FEM 메시를 자동 생성하지 않습니다.
        </p>
        {draft.asset && (
          <p className="file-name">{assetName ?? `${draft.asset.file.name} · 파일 재연결 필요`}</p>
        )}
        <button disabled={!onAsset || loading} onClick={() => model.current?.click()}>
          3D 모델 파일 선택
        </button>
        {assetFile && (
          <>
            <p>{assetFile.name}</p>
            <label>
              자산 출처·단위·부품 매핑
              <textarea
                aria-label="3D 자산 매핑"
                spellCheck={false}
                rows={12}
                value={mapping}
                onChange={(e) => setMapping(e.target.value)}
              />
            </label>
            <button disabled={loading} onClick={() => void importAsset()}>
              {loading ? '모델 읽는 중' : '3D 모델 적용'}
            </button>
          </>
        )}
        {assetName && <button onClick={onAssetClear}>개념 모델로 돌아가기</button>}
      </details>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="device-notice" role="status">
          {notice}
        </p>
      )}
      <input
        ref={photo}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="장치 사진 파일"
        onChange={(e) => {
          void addPhoto(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      <input
        ref={model}
        hidden
        type="file"
        accept=".glb,.gltf"
        aria-label="장치 3D 모델 파일"
        onChange={(e) => {
          prepareAsset(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </section>
  );
}
