param([Parameter(Mandatory = $true)][string]$XmlPath)

# Shows one Windows toast, built from an XML document written beside it.
#
# The payload comes in through a file rather than an argument: it carries
# session titles, which contain quotes and ampersands, and a command line is the
# wrong place to find that out.
#
# The application identity is borrowed from PowerShell, so the toast reads
# "Windows PowerShell" and lands in its entry of the notification settings.
# Carrying our own name and icon needs an AppUserModelID registered through a
# Start Menu shortcut, which is an install step and not a code change.

$ErrorActionPreference = 'Stop'

[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

$document = New-Object Windows.Data.Xml.Dom.XmlDocument
$document.LoadXml([System.IO.File]::ReadAllText($XmlPath))

$toast = New-Object Windows.UI.Notifications.ToastNotification $document
$appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
