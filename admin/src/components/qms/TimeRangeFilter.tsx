import { DatePicker, Segmented, Space } from "antd";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { TimeRange, TimeRangePreset } from "../../hooks/qms/useCachedTimeRange";

const { RangePicker } = DatePicker;

interface TimeRangeFilterProps {
  value: TimeRange;
  activePreset?: TimeRangePreset | "custom";
  onChange: (range: TimeRange) => void;
  onPresetChange: (preset: TimeRangePreset) => void;
  format?: string;
}

export default function TimeRangeFilter({
  value,
  activePreset,
  onChange,
  onPresetChange,
  format = "YYYY-MM-DD",
}: TimeRangeFilterProps) {
  const handleRangeChange = (dates: [Dayjs | null, Dayjs | null] | null) => {
    if (dates?.[0] && dates[1]) {
      onChange([dates[0].startOf("day").valueOf(), dates[1].endOf("day").valueOf()]);
    }
  };

  return (
    <Space wrap>
      <RangePicker
        value={[dayjs(value[0]), dayjs(value[1])]}
        onChange={handleRangeChange}
        format={format}
      />
      <Segmented
        value={activePreset === "today" || activePreset === "last7days" ? activePreset : undefined}
        onChange={(preset) => onPresetChange(preset as TimeRangePreset)}
        options={[
          { label: "今日", value: "today" },
          { label: "近一周", value: "last7days" },
        ]}
      />
    </Space>
  );
}
