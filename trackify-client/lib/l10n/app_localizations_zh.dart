// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for Chinese (`zh`).
class AppLocalizationsZh extends AppLocalizations {
  AppLocalizationsZh([String locale = 'zh']) : super(locale);

  @override
  String get trackingTitle => '实时追踪';

  @override
  String get settingsTitle => '设置';

  @override
  String get statusTitle => '日志';

  @override
  String get saveButton => '保存';

  @override
  String get cancelButton => '取消';

  @override
  String get okButton => '确认';

  @override
  String get locationButton => '发送位置';

  @override
  String get statusButton => '显示状态';

  @override
  String get settingsButton => '更改设置';

  @override
  String get invalidValue => '无效值';

  @override
  String get disabledValue => '不可用';

  @override
  String get idLabel => '设备标识符';

  @override
  String get urlLabel => '服务器地址';

  @override
  String get accuracyLabel => '定位精度';

  @override
  String get highestAccuracyLabel => '最高';

  @override
  String get highAccuracyLabel => '高';

  @override
  String get mediumAccuracyLabel => '中';

  @override
  String get lowAccuracyLabel => '低';

  @override
  String get intervalLabel => '间隔（秒）';

  @override
  String get fastestIntervalLabel => '最快间隔（秒）';

  @override
  String get distanceLabel => '距离（米）';

  @override
  String get angleLabel => '角度（度）';

  @override
  String get heartbeatLabel => '固定心跳包（秒）';

  @override
  String get bufferLabel => '离线缓冲';

  @override
  String get wakelockLabel => '唤醒锁';

  @override
  String get stopDetectionLabel => '停止检测';

  @override
  String get preferPlatformProvidersLabel => 'Use system location';

  @override
  String get trackingLabel => '持续追踪';

  @override
  String get advancedLabel => '高级设置';

  @override
  String get passwordLabel => '密码';

  @override
  String get optimizationMessage => '为了确保可靠的实时跟踪，请禁用此应用的电池优化。';

  @override
  String get passwordError => '密码错误';

  @override
  String get startAction => '启动服务';

  @override
  String get stopAction => '停止服务';

  @override
  String get sosAction => '发送求救信号';

  @override
  String get disclosureMessage => '该应用会在后台收集位置和活动数据，并将其发送到配置的服务器。';

  @override
  String get configurationMessage => 'Apply new configuration?';
}

/// The translations for Chinese, as used in Taiwan (`zh_TW`).
class AppLocalizationsZhTw extends AppLocalizationsZh {
  AppLocalizationsZhTw() : super('zh_TW');

  @override
  String get trackingTitle => '追蹤';

  @override
  String get settingsTitle => '設定';

  @override
  String get statusTitle => '記錄';

  @override
  String get saveButton => '儲存';

  @override
  String get cancelButton => '取消';

  @override
  String get okButton => '好的';

  @override
  String get locationButton => '發送位置';

  @override
  String get statusButton => '顯示狀態';

  @override
  String get settingsButton => '改變設定';

  @override
  String get invalidValue => '無效資料';

  @override
  String get disabledValue => '已停用';

  @override
  String get idLabel => '設備識別碼';

  @override
  String get urlLabel => '伺服器地址';

  @override
  String get accuracyLabel => '位置精度';

  @override
  String get highestAccuracyLabel => '最高';

  @override
  String get highAccuracyLabel => '高';

  @override
  String get mediumAccuracyLabel => '中';

  @override
  String get lowAccuracyLabel => '低';

  @override
  String get intervalLabel => '間隔(秒)';

  @override
  String get fastestIntervalLabel => '最快間隔（秒）';

  @override
  String get distanceLabel => '距離(米)';

  @override
  String get angleLabel => '角度（度）';

  @override
  String get heartbeatLabel => '靜止心跳（秒）';

  @override
  String get bufferLabel => '離線緩存';

  @override
  String get wakelockLabel => '喚醒鎖定';

  @override
  String get stopDetectionLabel => '停止偵測';

  @override
  String get trackingLabel => '持續追蹤';

  @override
  String get advancedLabel => '進階設定';

  @override
  String get passwordLabel => '密碼';

  @override
  String get optimizationMessage => '為確保追蹤的可靠性，請停用此應用程式的電池優化功能。';

  @override
  String get passwordError => '密碼錯誤';

  @override
  String get startAction => '開始服務';

  @override
  String get stopAction => '停止服務';

  @override
  String get sosAction => '發送 SOS 求救';

  @override
  String get disclosureMessage => '該應用程式會在背景收集位置和活動數據，並將其傳送到配置的伺服器。';

  @override
  String get configurationMessage => 'Apply new configuration?';
}
