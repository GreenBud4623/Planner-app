package app.planner.local;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget: today's classes and what's due today, plus a line about tomorrow.
 * The app stores a summary for the next days (WidgetBridgePlugin); the widget picks today's entry,
 * so it stays right after midnight even if the app isn't opened (it refreshes every 30 minutes).
 */
public class PlannerWidget extends AppWidgetProvider {

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, PlannerWidget.class));
        if (ids.length > 0) for (int id : ids) manager.updateAppWidget(id, build(context));
    }

    private static RemoteViews build(Context context) {
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_planner);

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, tap);

        String today = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
        JSONObject day = null;
        try {
            String raw = context.getSharedPreferences(WidgetBridgePlugin.PREFS, Context.MODE_PRIVATE)
                .getString(WidgetBridgePlugin.KEY, null);
            if (raw != null) day = new JSONObject(raw).optJSONObject("days").optJSONObject(today);
        } catch (Exception e) {
            day = null; // broken or old data: show the empty state
        }

        if (day == null) {
            views.setTextViewText(R.id.widget_title, "Planner");
            setOrHide(views, R.id.widget_classes, "");
            setOrHide(views, R.id.widget_due, "");
            setOrHide(views, R.id.widget_tomorrow, "");
            views.setTextViewText(R.id.widget_empty, "Open Planner to fill this widget");
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            return views;
        }

        views.setTextViewText(R.id.widget_title, day.optString("title", "Today"));
        String holiday = day.optString("holiday", "");
        String classes = holiday.isEmpty() ? lines(day.optJSONArray("classes")) : "🏖 " + holiday;
        String due = lines(day.optJSONArray("due"));
        setOrHide(views, R.id.widget_classes, classes);
        setOrHide(views, R.id.widget_due, due);
        setOrHide(views, R.id.widget_tomorrow, day.optString("tomorrow", ""));
        boolean empty = classes.isEmpty() && due.isEmpty();
        views.setTextViewText(R.id.widget_empty, "Nothing planned today 🎉");
        views.setViewVisibility(R.id.widget_empty, empty ? View.VISIBLE : View.GONE);
        return views;
    }

    private static String lines(JSONArray arr) {
        if (arr == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < arr.length(); i++) {
            String s = arr.optString(i, "");
            if (s.isEmpty()) continue;
            if (sb.length() > 0) sb.append('\n');
            sb.append(s);
        }
        return sb.toString();
    }

    private static void setOrHide(RemoteViews views, int id, String text) {
        views.setTextViewText(id, text);
        views.setViewVisibility(id, text.isEmpty() ? View.GONE : View.VISIBLE);
    }
}
