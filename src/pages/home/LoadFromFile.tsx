import { Group, Text } from '@mantine/core';
import { Dropzone, FileRejection, MIME_TYPES } from '@mantine/dropzone';
import { IconUpload } from '@tabler/icons-react';
import { ReactNode, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorAlert } from '../../components/ErrorAlert.tsx';
import { useAsync } from '../../hooks/use-async.ts';
import { useStore } from '../../store.ts';
import { parseAlgorithmLogs } from '../../utils/algorithm.tsx';
import { extractLogFromZip } from '../../utils/zip.ts';
import { HomeCard } from './HomeCard.tsx';

function DropzoneContent(): ReactNode {
  return (
    <Group justify="center" gap="xl" style={{ minHeight: 80, pointerEvents: 'none' }}>
      <IconUpload size={40}></IconUpload>
      <Text size="xl" inline={true}>
        Drag file here or click to select file
      </Text>
    </Group>
  );
}

export function LoadFromFile(): ReactNode {
  const navigate = useNavigate();

  const [error, setError] = useState<Error>();

  const setAlgorithm = useStore(state => state.setAlgorithm);

  const onDrop = useAsync(
    async (files: File[]) => {
      setError(undefined);

      const file = files[0];
      const normalizedName = file.name.toLowerCase();

      let logContents: string;

      if (normalizedName.endsWith('.zip')) {
        logContents = (await extractLogFromZip(file)).contents;
      } else if (normalizedName.endsWith('.log')) {
        logContents = await file.text();
      } else {
        throw new Error('Unsupported file type. Please upload a .log file or a .zip archive containing a .log file.');
      }

      setAlgorithm(parseAlgorithmLogs(logContents));
      navigate('/visualizer');
    },
  );

  const onReject = useCallback((rejections: FileRejection[]) => {
    const messages: string[] = [];

    for (const rejection of rejections) {
      const errorType = {
        'file-invalid-type': 'Invalid type, only .log files and .zip archives are supported.',
        'file-too-large': 'File too large.',
        'file-too-small': 'File too small.',
        'too-many-files': 'Too many files.',
      }[rejection.errors[0].code]!;

      messages.push(`Could not load algorithm from ${rejection.file.name}: ${errorType}`);
    }

    setError(new Error(messages.join('<br/>')));
  }, []);

  return (
    <HomeCard title="Load from file">
      <Text>
        Supports official Prosperity 4 exported <code>.log</code> files and the legacy logger-based text logs used by
        older local backtests.
      </Text>
      <Text>
        You can also upload a <code>.zip</code> archive from Prosperity. If it contains a <code>.log</code> file, the
        visualizer will extract and open it automatically.
      </Text>
      <Text>
        If Prosperity gives you both a <code>.log</code> file and a <code>.json</code> file, upload the{' '}
        <code>.log</code> file here. The summary <code>.json</code> export does not include the per-timestamp logs
        needed by the visualizer.
      </Text>

      {error && <ErrorAlert error={error} />}
      {onDrop.error && <ErrorAlert error={onDrop.error} />}

      <Dropzone
        onDrop={onDrop.call}
        onReject={onReject}
        multiple={false}
        loading={onDrop.loading}
        accept={{
          'application/octet-stream': ['.log', '.zip'],
          'application/json': ['.log'],
          [MIME_TYPES.zip]: ['.zip'],
          'text/plain': ['.log'],
        }}
      >
        <Dropzone.Idle>
          <DropzoneContent />
        </Dropzone.Idle>
        <Dropzone.Accept>
          <DropzoneContent />
        </Dropzone.Accept>
      </Dropzone>
    </HomeCard>
  );
}
