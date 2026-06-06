import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      "inspector": "Inspector",
      "export": "Export",
      "export_all": "Export All",
      "ready_to_process": "Ready to Process",
      "drop_hint": "Drop high-res photos here to start surgery",
      "batch_queue": "Batch Queue",
      "watermark_text": "Watermark Text",
      "size": "Size",
      "color": "Color",
      "opacity": "Opacity",
      "position": "Position",
      "upload_logo": "Upload Logo (PNG)",
      "click_to_select": "Click to Select PNG",
      "processing": "Processing Batch",
      "saving_info": "Saving {{current}} of {{total}} images...",
      "export_done": "Done",
      "source_verified": "Source Verified",
      "type_text": "Text",
      "type_logo": "Logo",
      "placeholder": "Enter watermark...",
      "add_images_first": "Please add images first",
      "add_image": "Add Image",
      "drop_to_add": "Drop to add photos",
      "custom_color": "Custom",
      "position_custom": "Custom · drag",
      "remove": "Remove",
      "heic_failed": "Couldn't convert these HEIC photos: {{names}}"
    }
  },
  zh: {
    translation: {
      "inspector": "检视器",
      "export": "导出",
      "export_all": "批量导出",
      "ready_to_process": "准备就绪",
      "drop_hint": "拖入高清照片开始无损处理",
      "batch_queue": "待处理队列",
      "watermark_text": "水印文字内容",
      "size": "字号大小",
      "color": "颜色",
      "opacity": "透明度",
      "position": "预设位置",
      "upload_logo": "上传水印图标 (PNG)",
      "click_to_select": "点击选择 PNG 图片",
      "processing": "批量处理中",
      "saving_info": "正在保存第 {{current}} 张，共 {{total}} 张...",
      "export_done": "完成",
      "source_verified": "原片元数据已锁定",
      "type_text": "文字",
      "type_logo": "图标",
      "placeholder": "输入水印内容...",
      "add_images_first": "请先添加图片",
      "add_image": "添加图片",
      "drop_to_add": "拖入照片以添加",
      "custom_color": "自定义",
      "position_custom": "自定义 · 拖动",
      "remove": "移除",
      "heic_failed": "无法转换这些 HEIC 照片：{{names}}"
    }
  },
  ja: {
    translation: {
      "inspector": "インスペクター",
      "export": "書き出し",
      "export_all": "一括書き出し",
      "ready_to_process": "処理準備完了",
      "drop_hint": "高解像度写真をドロップして開始",
      "batch_queue": "バッチキュー",
      "watermark_text": "透かしテキスト",
      "size": "サイズ",
      "color": "カラー",
      "opacity": "不透明度",
      "position": "配置プリセット",
      "upload_logo": "ロゴをアップロード (PNG)",
      "click_to_select": "PNGファイルを選択",
      "processing": "一括処理中",
      "saving_info": "{{total}}枚中{{current}}枚目を保存中...",
      "export_done": "完了",
      "source_verified": "メタデータ保護済み",
      "type_text": "テキスト",
      "type_logo": "ロゴ",
      "placeholder": "透かしを入力...",
      "add_images_first": "先に画像を追加してください",
      "add_image": "画像を追加",
      "drop_to_add": "ドロップして写真を追加",
      "custom_color": "カスタム",
      "position_custom": "カスタム · ドラッグ",
      "remove": "削除",
      "heic_failed": "これらのHEIC写真を変換できませんでした: {{names}}"
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  }).catch(err => {
    console.error("i18n initialization failed:", err);
  });

export default i18n;
