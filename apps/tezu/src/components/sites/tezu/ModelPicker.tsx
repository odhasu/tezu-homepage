"use client";

/* eslint-disable @next/next/no-img-element */
import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { asset } from "./assets";
import "./model-picker.css";

type ModelOption = { id: string; name: string; logo: string };

export function ModelPicker({ models, value, onValueChange }: {
  models: ModelOption[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  const selected = models.find(model => model.id === value) ?? models[0];

  return (
    <Select.Root value={value} onValueChange={next => { if (next !== null) onValueChange(next); }} items={models.map(model => ({ value: model.id, label: model.name }))} modal={false}>
      <Select.Trigger className="stage-model" aria-label="AI model">
        <img className="stage-model-logo" src={asset(selected.logo)} alt="" width={20} height={20} />
        <Select.Value className="stage-model-name" />
        <Select.Icon className="stage-model-chevron"><ChevronDown size={13} aria-hidden="true" /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="stage-model-positioner" side="bottom" align="start" sideOffset={8} collisionPadding={16} alignItemWithTrigger={false}>
          <Select.Popup className="stage-model-popup">
            <Select.List className="stage-model-list" aria-label="AI models">
              {models.map(model => (
                <Select.Item key={model.id} value={model.id} label={model.name} className="stage-model-option">
                  <span className="stage-model-brand"><img src={asset(model.logo)} alt="" width={24} height={24} /></span>
                  <Select.ItemText className="stage-model-option-name">{model.name}</Select.ItemText>
                  <Select.ItemIndicator className="stage-model-check"><Check size={16} aria-hidden="true" /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
