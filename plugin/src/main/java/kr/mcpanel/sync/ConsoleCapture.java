package kr.mcpanel.sync;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import kr.mcpanel.net.PanelServer;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.core.LogEvent;
import org.apache.logging.log4j.core.Logger;
import org.apache.logging.log4j.core.appender.AbstractAppender;
import org.apache.logging.log4j.core.config.Property;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.regex.Pattern;

/**
 * 서버 콘솔 로그를 가로채서 최근 N줄을 보관하고, 새 줄을 웹에 "console" 이벤트로 보낸다.
 */
public final class ConsoleCapture {

    private static final Pattern ANSI = Pattern.compile("\u001B\\[[;\\d]*[A-Za-z]");
    private static final Pattern SECTION = Pattern.compile("§[0-9a-fk-orx]", Pattern.CASE_INSENSITIVE);
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm:ss").withZone(ZoneId.systemDefault());

    private final int maxLines;
    private final Deque<String> buffer = new ArrayDeque<>();
    private PanelServer server;
    private Appender appender;

    public ConsoleCapture(int maxLines) {
        this.maxLines = Math.max(50, maxLines);
    }

    public void setServer(PanelServer server) {
        this.server = server;
    }

    public void install() {
        appender = new Appender();
        appender.start();
        ((Logger) LogManager.getRootLogger()).addAppender(appender);
    }

    public void uninstall() {
        if (appender == null) return;
        ((Logger) LogManager.getRootLogger()).removeAppender(appender);
        appender.stop();
        appender = null;
    }

    public JsonObject history() {
        JsonArray arr = new JsonArray();
        synchronized (buffer) {
            for (String line : buffer) arr.add(line);
        }
        JsonObject o = new JsonObject();
        o.add("lines", arr);
        return o;
    }

    private void add(String line) {
        synchronized (buffer) {
            buffer.addLast(line);
            while (buffer.size() > maxLines) buffer.removeFirst();
        }
        if (server != null) {
            JsonObject o = new JsonObject();
            o.addProperty("line", line);
            server.broadcastEvent("console", o);
        }
    }

    private final class Appender extends AbstractAppender {

        Appender() {
            super("WebPanelConsole", null, null, true, Property.EMPTY_ARRAY);
        }

        @Override
        public void append(LogEvent event) {
            String msg = event.getMessage() != null ? event.getMessage().getFormattedMessage() : "";
            msg = SECTION.matcher(ANSI.matcher(msg).replaceAll("")).replaceAll("");
            String loggerName = event.getLoggerName();
            String prefix = loggerName != null && !loggerName.isEmpty() && !loggerName.contains(".")
                    && !msg.startsWith("[" + loggerName + "]") ? "[" + loggerName + "] " : "";
            StringBuilder sb = new StringBuilder();
            sb.append('[').append(TIME.format(Instant.ofEpochMilli(event.getTimeMillis()))).append(' ')
                    .append(event.getLevel().name()).append("]: ").append(prefix).append(msg);
            if (event.getThrown() != null) {
                sb.append('\n').append(event.getThrown());
            }
            add(sb.toString());
        }
    }
}
